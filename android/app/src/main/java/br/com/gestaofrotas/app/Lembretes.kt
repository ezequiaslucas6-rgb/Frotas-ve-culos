package br.com.gestaofrotas.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Lembretes do checklist no celular, no horário de Pimenta Bueno (America/Porto_Velho):
 *   08:00 -> motorista: o checklist do dia (diário até 08:30; semanal no sábado/domingo)
 *   08:30 -> supervisor/admin: quantos fizeram e quantos esperam a decisão de liberar
 * Na hora, o app pergunta ao sistema (/api/lembretes, com a sessão do próprio app) o que
 * avisar: quem já fez o checklist não é incomodado. Sem internet às 08:00, o motorista
 * recebe um lembrete simples.
 */
object Lembretes {
    const val CANAL = "lembretes"
    const val EXTRA_MOMENTO = "momento"
    const val EXTRA_ABRIR = "abrir"
    private val FUSO: ZoneId = ZoneId.of("America/Porto_Velho")
    private val HORARIOS = listOf("0800" to (8 to 0), "0830" to (8 to 30))

    /** Agenda (ou reagenda) os dois lembretes do próximo horário de cada um. */
    fun agendar(context: Context) {
        val alarmes = context.getSystemService(AlarmManager::class.java) ?: return
        val agora = ZonedDateTime.now(FUSO)
        for ((momento, horario) in HORARIOS) {
            var quando = agora.withHour(horario.first).withMinute(horario.second).withSecond(0).withNano(0)
            if (!quando.isAfter(agora)) quando = quando.plusDays(1)
            // inexato (o Android junta alarmes para poupar bateria): chega em poucos minutos
            alarmes.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, quando.toInstant().toEpochMilli(), pendente(context, momento))
        }
    }

    private fun pendente(context: Context, momento: String): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            momento.toInt(),
            Intent(context, LembreteReceiver::class.java).putExtra(EXTRA_MOMENTO, momento),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    fun criarCanal(context: Context) {
        val canal = NotificationChannel(CANAL, context.getString(R.string.lembretes_canal), NotificationManager.IMPORTANCE_HIGH)
        canal.description = context.getString(R.string.lembretes_canal_descricao)
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(canal)
    }

    fun podeNotificar(context: Context) =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission") // conferida em podeNotificar(); retirada no meio vira SecurityException
    fun notificar(context: Context, id: String, titulo: String, texto: String, caminho: String) {
        if (!podeNotificar(context)) return
        criarCanal(context)
        val abrir = Intent(context, MainActivity::class.java)
            .putExtra(EXTRA_ABRIR, caminho)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val toque = PendingIntent.getActivity(context, id.hashCode(), abrir, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, CANAL)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setColor(ContextCompat.getColor(context, R.color.icone))
            .setContentTitle(titulo)
            .setContentText(texto)
            .setStyle(NotificationCompat.BigTextStyle().bigText(texto))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(toque)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(id.hashCode(), n)
        } catch (e: SecurityException) {
            // permissão retirada entre a conferência e o aviso
        }
    }

    /** Pergunta ao sistema o que avisar agora. null = sem conexão (aí vale o lembrete simples). */
    fun consultar(momento: String, cookies: String?): Resposta? {
        val endereco = "${BuildConfig.APP_URL.trimEnd('/')}/api/lembretes?momento=$momento"
        val conexao = URL(endereco).openConnection() as HttpURLConnection
        // o Android dá poucos segundos ao alarme: tempo curto, e sem internet vale o lembrete simples
        conexao.connectTimeout = 6_000
        conexao.readTimeout = 6_000
        // sem login o sistema redireciona para a tela de entrada: não seguir (não há o que avisar)
        conexao.instanceFollowRedirects = false
        conexao.setRequestProperty("Accept", "application/json")
        if (!cookies.isNullOrBlank()) conexao.setRequestProperty("Cookie", cookies)
        return try {
            val status = conexao.responseCode
            // a sessão renovada pelo sistema volta para o app (como faria o WebView)
            val novos = conexao.headerFields.filterKeys { it.equals("Set-Cookie", ignoreCase = true) }.values.flatten()
            if (novos.isNotEmpty()) guardarCookies(endereco, novos)
            // 401, ou o redirecionamento para a tela de entrada: a sessão deste celular acabou
            if (status == HttpURLConnection.HTTP_UNAUTHORIZED || status in 300..399) return Resposta(emptyList(), null, semLogin = true)
            if (status != HttpURLConnection.HTTP_OK) return Resposta(emptyList(), null)
            val json = JSONObject(conexao.inputStream.bufferedReader().use { it.readText() })
            val lista = json.optJSONArray("notificacoes")
            val itens = (0 until (lista?.length() ?: 0)).map { i ->
                val o = lista!!.getJSONObject(i)
                Aviso(o.getString("id"), o.getString("titulo"), o.getString("texto"), o.optString("url", "/"))
            }
            Resposta(itens, json.optString("papel").ifBlank { null })
        } catch (e: IOException) {
            null
        } catch (e: Exception) {
            Resposta(emptyList(), null)
        } finally {
            conexao.disconnect()
        }
    }

    /**
     * Grava a sessão renovada ANTES de o alarme terminar. O Supabase troca o "refresh token" a
     * cada renovação e o antigo deixa de valer: se o novo se perdesse (o Android encerra o
     * processo logo depois do alarme), o app voltaria com o antigo e o Supabase encerraria a
     * sessão por reuso, e o motorista teria de entrar de novo.
     */
    private fun guardarCookies(url: String, cookies: List<String>) {
        val gravado = CountDownLatch(1)
        Handler(Looper.getMainLooper()).post {
            try {
                val gerenciador = CookieManager.getInstance()
                cookies.forEach { gerenciador.setCookie(url, it) }
                gerenciador.flush()
            } finally {
                gravado.countDown()
            }
        }
        gravado.await(3, TimeUnit.SECONDS) // roda fora da thread principal (sem travar o app)
    }

    data class Aviso(val id: String, val titulo: String, val texto: String, val url: String)
    data class Resposta(val avisos: List<Aviso>, val papel: String?, val semLogin: Boolean = false)
}

/** Dispara nos horários dos lembretes e reagenda depois de reiniciar o celular ou atualizar o app. */
class LembreteReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Lembretes.agendar(context) // o próximo (amanhã), e também após reiniciar/atualizar
        val momento = intent.getStringExtra(Lembretes.EXTRA_MOMENTO) ?: return
        val prefs = context.getSharedPreferences("lembretes", Context.MODE_PRIVATE)
        val cookies = runCatching { CookieManager.getInstance().getCookie(BuildConfig.APP_URL) }.getOrNull()
        val pendente = goAsync()
        thread(name = "lembrete-$momento") {
            try {
                val resposta = Lembretes.consultar(momento, cookies)
                if (resposta == null) {
                    // sem internet: o motorista recebe o lembrete simples às 08:00
                    if (momento == "0800" && prefs.getString("papel", null) == "motorista") {
                        Lembretes.notificar(
                            context,
                            "diario-offline",
                            context.getString(R.string.lembrete_offline_titulo),
                            context.getString(R.string.lembrete_offline_texto),
                            "/meu-veiculo",
                        )
                    }
                } else if (resposta.semLogin) {
                    // saiu do app (ou a sessão foi encerrada): avisa no horário do papel dele, para não ficar sem lembrete
                    val papel = prefs.getString("papel", null)
                    if (papel != null && (papel == "motorista") == (momento == "0800")) {
                        Lembretes.notificar(
                            context,
                            "sem-login",
                            context.getString(R.string.lembrete_sem_login_titulo),
                            context.getString(R.string.lembrete_sem_login_texto),
                            "/login",
                        )
                    }
                } else {
                    resposta.papel?.let { prefs.edit().putString("papel", it).apply() }
                    resposta.avisos.forEach { Lembretes.notificar(context, it.id, it.titulo, it.texto, it.url) }
                }
            } finally {
                pendente.finish()
            }
        }
    }
}
