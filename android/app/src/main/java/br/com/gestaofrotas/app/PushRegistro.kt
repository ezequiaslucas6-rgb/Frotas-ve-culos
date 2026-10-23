package br.com.gestaofrotas.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Push do servidor (Firebase Cloud Messaging): o servidor envia a notificação no minuto exato
 * (08:00 motorista, 08:30 supervisor/admin) e o Android acorda o app na hora, sem depender de
 * alarme do próprio celular. Aqui o app entrega o token deste aparelho ao servidor, com a sessão
 * do próprio app (cookies do WebView). Sem o google-services.json no build, nada disto roda e o
 * app usa só o alarme local ([Lembretes]).
 */
object PushRegistro {
    private const val PREFS = "push"
    private const val COOKIE_APARELHO = "frotas_push="
    private const val ENTRE_TENTATIVAS_MS = 30_000L
    private const val RENOVAR_MS = 24 * 60 * 60 * 1000L

    /** Quanto tempo depois do horário o alarme local confere (rede de segurança do push). */
    const val ATRASO_REDE_DE_SEGURANCA_MIN = 3L

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** O servidor já tem o token deste aparelho: o aviso vem por push e o alarme local fica de reserva. */
    fun ativo(context: Context) = prefs(context).getBoolean("registrado", false)

    /** Chegou um push agora há pouco? (o alarme local de reserva não precisa avisar de novo) */
    fun recebido(context: Context) = prefs(context).edit().putLong("ultimo_push_em", System.currentTimeMillis()).apply()

    fun recebeuHaPouco(context: Context, minutos: Long = 20) =
        System.currentTimeMillis() - prefs(context).getLong("ultimo_push_em", 0) < minutos * 60_000

    /** O Firebase trocou o token: força um novo registro assim que houver sessão. */
    fun tokenMudou(context: Context) = prefs(context).edit().remove("enviado_token").apply()

    /** Lê os cookies na thread principal (como o WebView exige) e registra o aparelho. */
    fun registrarComSessao(context: Context) {
        val app = context.applicationContext
        Handler(Looper.getMainLooper()).post {
            registrar(app, runCatching { CookieManager.getInstance().getCookie(BuildConfig.APP_URL) }.getOrNull())
        }
    }

    /** Entrega o token ao servidor (se ainda não entregou, se mudou ou se já faz um dia). `cookies` = sessão do app. */
    fun registrar(context: Context, cookies: String?) {
        if (cookies.isNullOrBlank()) return
        val p = prefs(context)
        val agora = System.currentTimeMillis()
        if (agora - p.getLong("tentativa_em", 0) < ENTRE_TENTATIVAS_MS) return
        p.edit().putLong("tentativa_em", agora).apply()
        // sem google-services.json o Firebase não é iniciado: este build não tem push
        val mensageiro = runCatching { FirebaseMessaging.getInstance() }.getOrNull() ?: return
        mensageiro.token.addOnCompleteListener { tarefa ->
            val token = if (tarefa.isSuccessful) tarefa.result else null
            if (token.isNullOrBlank()) return@addOnCompleteListener
            // o cookie do aparelho some quando a pessoa sai da conta: aí registra de novo
            val jaRegistrado = cookies.contains(COOKIE_APARELHO) &&
                p.getString("enviado_token", null) == token &&
                agora - p.getLong("enviado_em", 0) < RENOVAR_MS
            if (!jaRegistrado) thread(name = "push-registro") { enviar(context, token, cookies) }
        }
    }

    private fun enviar(context: Context, token: String, cookies: String) {
        val endereco = "${BuildConfig.APP_URL.trimEnd('/')}/api/push/fcm"
        val conexao = URL(endereco).openConnection() as HttpURLConnection
        try {
            conexao.requestMethod = "POST"
            conexao.connectTimeout = 10_000
            conexao.readTimeout = 10_000
            // sem login o sistema redireciona para a tela de entrada: tenta de novo quando a pessoa entrar
            conexao.instanceFollowRedirects = false
            conexao.doOutput = true
            conexao.setRequestProperty("Content-Type", "application/json")
            conexao.setRequestProperty("Cookie", cookies)
            conexao.outputStream.use { it.write(JSONObject().put("token", token).toString().toByteArray()) }
            if (conexao.responseCode != HttpURLConnection.HTTP_OK) return
            // guarda o cookie do aparelho (o "Sair" do sistema o usa) e a sessão renovada
            val novos = conexao.headerFields.filterKeys { it.equals("Set-Cookie", ignoreCase = true) }.values.flatten()
            if (novos.isNotEmpty()) Lembretes.guardarCookies(endereco, novos)
            prefs(context).edit()
                .putString("enviado_token", token)
                .putLong("enviado_em", System.currentTimeMillis())
                .putBoolean("registrado", true)
                .apply()
            // agora o alarme local vira reserva (3 min depois do horário)
            Lembretes.agendar(context)
        } catch (e: Exception) {
            // sem rede agora: tenta na próxima abertura
        } finally {
            conexao.disconnect()
        }
    }
}
