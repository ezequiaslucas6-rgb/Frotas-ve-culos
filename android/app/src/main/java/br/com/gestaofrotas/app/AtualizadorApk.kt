package br.com.gestaofrotas.app

import android.app.AlertDialog
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Environment
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.concurrent.thread

/**
 * Atualização do próprio APK. Só é preciso quando a parte Android muda: o sistema em si
 * (telas, regras) vem da internet e se atualiza sozinho.
 *
 * Confere o versao.json publicado junto com o APK no GitHub (no máximo a cada 6 h), pergunta,
 * baixa, confere o arquivo (SHA-256) e abre o instalador do Android, que instala por cima
 * (o APK é assinado sempre com a mesma chave). Na primeira vez o Android pede para permitir
 * "instalar apps desconhecidos" para o Rodar.
 */
class AtualizadorApk(private val activity: ComponentActivity) {

    private data class Versao(val codigo: Int, val nome: String, val url: String, val sha256: String)

    private val prefs = activity.getSharedPreferences("atualizacao_apk", Context.MODE_PRIVATE)
    private var baixando: Long = -1
    private var aguardandoPermissao: File? = null
    private var receptor: BroadcastReceiver? = null

    /** Confere se há versão nova do APK (no máximo a cada 6 h, ou sempre com [forcar]). */
    fun verificar(forcar: Boolean = false) {
        val endereco = BuildConfig.ATUALIZACAO_URL
        if (endereco.isBlank() || baixando >= 0) return
        val agora = System.currentTimeMillis()
        if (!forcar && agora - prefs.getLong("conferido_em", 0) < INTERVALO_MS) return
        prefs.edit().putLong("conferido_em", agora).apply()
        thread(name = "atualizador-apk") {
            val versao = runCatching { lerVersao(endereco) }.getOrNull() ?: return@thread
            if (versao.codigo <= BuildConfig.VERSION_CODE) return@thread
            // "Depois" adia a pergunta desta versão por um dia
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
        receptor?.let { runCatching { activity.unregisterReceiver(it) } }
        receptor = null
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
        if (activity.isFinishing || activity.isDestroyed) return
        AlertDialog.Builder(activity)
            .setTitle(R.string.atualizacao_titulo)
            .setMessage(activity.getString(R.string.atualizacao_texto, v.nome))
            .setPositiveButton(R.string.atualizacao_atualizar) { _, _ -> baixar(v) }
            .setNegativeButton(R.string.atualizacao_depois) { _, _ ->
                prefs.edit().putInt("adiada_codigo", v.codigo).putLong("adiada_em", System.currentTimeMillis()).apply()
            }
            .show()
    }

    private fun baixar(v: Versao) {
        val pasta = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return
        pasta.listFiles()?.filter { it.name.endsWith(".apk") }?.forEach { it.delete() } // sobras de versões antigas
        val nome = "rodar-${v.codigo}.apk"
        val destino = File(pasta, nome)
        val pedido = DownloadManager.Request(Uri.parse(v.url))
            .setTitle(activity.getString(R.string.atualizacao_baixando))
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, nome)
        val gerenciador = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

        encerrar()
        val novo = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) != baixando) return
                baixando = -1
                encerrar()
                // só instala o arquivo que foi publicado (mesmo SHA-256 do versao.json)
                if (!destino.exists() || sha256(destino) != v.sha256) {
                    destino.delete()
                    Toast.makeText(activity, R.string.atualizacao_falhou, Toast.LENGTH_LONG).show()
                    return
                }
                instalar(destino)
            }
        }
        receptor = novo
        ContextCompat.registerReceiver(
            activity,
            novo,
            IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            ContextCompat.RECEIVER_EXPORTED,
        )
        baixando = gerenciador.enqueue(pedido)
        Toast.makeText(activity, R.string.atualizacao_baixando, Toast.LENGTH_SHORT).show()
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
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.arquivos", arquivo)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { activity.startActivity(intent) }
            .onFailure { Toast.makeText(activity, R.string.atualizacao_falhou, Toast.LENGTH_LONG).show() }
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
        const val INTERVALO_MS = 6 * 60 * 60 * 1000L
        const val ADIAR_MS = 24 * 60 * 60 * 1000L
    }
}
