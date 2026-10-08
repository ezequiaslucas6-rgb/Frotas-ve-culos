package br.com.gestaofrotas.app

import android.app.AlertDialog
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.ComponentActivity
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.concurrent.thread

/**
 * Atualização do próprio APK, por dentro do app. Só é preciso quando a parte Android muda:
 * o sistema em si (telas, regras) vem da internet e se atualiza sozinho.
 *
 * Ao abrir (e ao voltar ao app) confere o versao.json publicado junto com o APK no GitHub.
 * Se há versão nova, pergunta; com "Atualizar", baixa dentro do app (barra de progresso),
 * confere o arquivo (SHA-256) e instala pela sessão de instalação do Android
 * (PackageInstaller), sem abrir arquivo nem navegador:
 *  - Android 12 ou mais novo: quando o próprio Rodar foi quem instalou a versão atual (a partir
 *    da segunda atualização feita assim), instala sem nenhuma pergunta e o app reabre pela
 *    notificação "Rodar atualizado".
 *  - Antes disso (ou se o sistema exigir): o Android mostra só a tela "Atualizar este app?".
 * Na primeira vez o Android pede para permitir que o Rodar instale atualizações.
 */
class AtualizadorApk(private val activity: ComponentActivity) {

    private data class Versao(val codigo: Int, val nome: String, val url: String, val sha256: String)

    private val prefs = activity.getSharedPreferences("atualizacao_apk", Context.MODE_PRIVATE)
    @Volatile private var ocupado = false
    private var aguardandoPermissao: File? = null
    private var progresso: AlertDialog? = null

    /** Confere se há versão nova do APK (no máximo a cada poucos minutos, ou sempre com [forcar]). */
    fun verificar(forcar: Boolean = false) {
        val endereco = BuildConfig.ATUALIZACAO_URL
        if (endereco.isBlank() || ocupado) return
        val agora = System.currentTimeMillis()
        if (!forcar && agora - prefs.getLong("conferido_em", 0) < INTERVALO_MS) return
        prefs.edit().putLong("conferido_em", agora).apply()
        thread(name = "atualizador-apk") {
            val versao = runCatching { lerVersao(endereco) }.getOrNull() ?: return@thread
            if (versao.codigo <= BuildConfig.VERSION_CODE) return@thread
            // "Depois" adia a pergunta desta versão por algumas horas
            val adiada = prefs.getInt("adiada_codigo", 0) == versao.codigo &&
                agora - prefs.getLong("adiada_em", 0) < ADIAR_MS
            if (adiada && !forcar) return@thread
            activity.runOnUiThread { perguntar(versao) }
        }
    }

    /** Ao voltar das configurações (permissão de instalar), segue com a instalação. */
    fun aoRetomar() {
        val arquivo = aguardandoPermissao ?: return
        if (podeInstalar()) {
            aguardandoPermissao = null
            instalar(arquivo)
        }
    }

    fun encerrar() {
        progresso?.dismiss()
        progresso = null
    }

    private fun lerVersao(endereco: String): Versao? {
        val conexao = URL(endereco).openConnection() as HttpURLConnection
        conexao.connectTimeout = 10_000
        conexao.readTimeout = 10_000
        conexao.instanceFollowRedirects = true
        conexao.setRequestProperty("Cache-Control", "no-cache")
        try {
            if (conexao.responseCode != HttpURLConnection.HTTP_OK) return null
            val json = JSONObject(conexao.inputStream.bufferedReader().use { it.readText() })
            return Versao(
                codigo = json.getInt("versionCode"),
                nome = json.optString("versionName", json.getInt("versionCode").toString()),
                url = json.getString("url"),
                sha256 = json.getString("sha256").lowercase(),
            )
        } finally {
            conexao.disconnect()
        }
    }

    private fun perguntar(v: Versao) {
        if (activity.isFinishing || activity.isDestroyed || ocupado) return
        AlertDialog.Builder(activity)
            .setTitle(R.string.atualizacao_titulo)
            .setMessage(activity.getString(R.string.atualizacao_texto, v.nome))
            .setPositiveButton(R.string.atualizacao_atualizar) { _, _ -> baixar(v) }
            .setNegativeButton(R.string.atualizacao_depois) { _, _ ->
                prefs.edit().putInt("adiada_codigo", v.codigo).putLong("adiada_em", System.currentTimeMillis()).apply()
            }
            .show()
    }

    /** Baixa dentro do app, mostrando o progresso. */
    private fun baixar(v: Versao) {
        ocupado = true
        val barra = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
            max = 100
            val margem = (24 * resources.displayMetrics.density).toInt()
            setPadding(margem, margem / 2, margem, 0)
        }
        progresso = AlertDialog.Builder(activity)
            .setTitle(R.string.atualizacao_baixando)
            .setView(barra)
            .setCancelable(false)
            .show()

        val pasta = File(activity.cacheDir, "atualizacoes").apply { mkdirs() }
        pasta.listFiles()?.forEach { it.delete() } // sobras de versões antigas
        val destino = File(pasta, "rodar-${v.codigo}.apk")
        thread(name = "atualizador-download") {
            val ok = runCatching {
                val conexao = URL(v.url).openConnection() as HttpURLConnection
                conexao.connectTimeout = 15_000
                conexao.readTimeout = 30_000
                conexao.instanceFollowRedirects = true
                try {
                    if (conexao.responseCode != HttpURLConnection.HTTP_OK) error("HTTP ${conexao.responseCode}")
                    val total = conexao.contentLengthLong
                    var baixados = 0L
                    var ultimo = -1
                    conexao.inputStream.use { entrada ->
                        destino.outputStream().use { saida ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                val lidos = entrada.read(buffer)
                                if (lidos < 0) break
                                saida.write(buffer, 0, lidos)
                                baixados += lidos
                                val pct = if (total > 0) (baixados * 100 / total).toInt() else -1
                                if (pct != ultimo && pct >= 0) {
                                    ultimo = pct
                                    activity.runOnUiThread {
                                        barra.isIndeterminate = false
                                        barra.progress = pct
                                    }
                                }
                            }
                        }
                    }
                } finally {
                    conexao.disconnect()
                }
                // só instala o arquivo que foi publicado (mesmo SHA-256 do versao.json)
                sha256(destino) == v.sha256
            }.getOrDefault(false)
            activity.runOnUiThread {
                encerrar()
                if (ok) {
                    instalar(destino)
                } else {
                    ocupado = false
                    destino.delete()
                    Toast.makeText(activity, R.string.atualizacao_falhou, Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun podeInstalar() = activity.packageManager.canRequestPackageInstalls()

    private fun instalar(arquivo: File) {
        if (!podeInstalar()) {
            // primeira vez: o Android pede para permitir que o Rodar instale a atualização
            aguardandoPermissao = arquivo
            Toast.makeText(activity, R.string.atualizacao_permissao, Toast.LENGTH_LONG).show()
            runCatching {
                activity.startActivity(
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")),
                )
            }
            return
        }
        Toast.makeText(activity, R.string.atualizacao_instalando, Toast.LENGTH_SHORT).show()
        thread(name = "atualizador-instalar") {
            val erro = runCatching { instalarPorSessao(arquivo) }.exceptionOrNull()
            activity.runOnUiThread {
                // entregue ao Android (ou falhou): se a pessoa cancelar a confirmação, pergunta de novo depois
                ocupado = false
                if (erro != null) Toast.makeText(activity, R.string.atualizacao_falhou, Toast.LENGTH_LONG).show()
            }
        }
    }

    /** Sessão de instalação do Android: o resultado chega em [ResultadoAtualizacao]. */
    private fun instalarPorSessao(arquivo: File) {
        val instalador = activity.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(activity.packageName)
            setSize(arquivo.length())
            // Android 12+: sem pergunta quando o Rodar é quem instalou a versão atual
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }
        val id = instalador.createSession(params)
        try {
            instalador.openSession(id).use { sessao ->
                sessao.openWrite("rodar.apk", 0, arquivo.length()).use { saida ->
                    arquivo.inputStream().use { it.copyTo(saida) }
                    sessao.fsync(saida)
                }
                val resultado = Intent(activity, ResultadoAtualizacao::class.java)
                val pendente = PendingIntent.getBroadcast(
                    activity,
                    id,
                    resultado,
                    // o Android preenche o status no Intent: precisa ser mutável (o Intent é explícito)
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                )
                sessao.commit(pendente.intentSender)
            }
        } catch (e: Exception) {
            runCatching { instalador.abandonSession(id) }
            throw e
        } finally {
            arquivo.delete()
        }
    }

    private fun sha256(arquivo: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        arquivo.inputStream().use { entrada ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val lidos = entrada.read(buffer)
                if (lidos < 0) break
                digest.update(buffer, 0, lidos)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private companion object {
        /** confere a cada abertura (com um intervalo mínimo para não repetir em toda troca de tela) */
        const val INTERVALO_MS = 5 * 60 * 1000L
        const val ADIAR_MS = 4 * 60 * 60 * 1000L
    }
}

/**
 * Resultado da sessão de instalação. Se o Android exigir confirmação, abre a tela dele
 * ("Atualizar este app?"); se falhar, avisa. No sucesso o app é reiniciado pelo sistema e
 * [AppAtualizado] avisa que pode abrir de novo.
 */
class ResultadoAtualizacao : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirmar = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                } ?: return
                confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { context.startActivity(confirmar) }
            }
            PackageInstaller.STATUS_SUCCESS -> Unit
            PackageInstaller.STATUS_FAILURE_ABORTED -> Unit // a pessoa cancelou
            else -> Toast.makeText(context, R.string.atualizacao_falhou, Toast.LENGTH_LONG).show()
        }
    }
}

/** Depois de atualizado, o Android fecha o app: a notificação leva de volta a ele. */
class AppAtualizado : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        Lembretes.notificar(
            context,
            "app-atualizado",
            context.getString(R.string.atualizacao_concluida_titulo),
            context.getString(R.string.atualizacao_concluida_texto, BuildConfig.VERSION_NAME),
            "/",
        )
    }
}
