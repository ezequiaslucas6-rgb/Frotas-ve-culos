package br.com.gestaofrotas.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.view.View
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File

/**
 * O app é o próprio sistema web (Next.js na VPS) dentro de um WebView, ajustado ao celular:
 *  - respeita barra de status, recorte da câmera, barra de navegação e teclado;
 *  - <input type="file"> abre a câmera ou a galeria (checklist, CNH, cupom de abastecimento);
 *  - WhatsApp, telefone, PDFs e links de outros sites abrem no app certo do celular;
 *  - botão "voltar" volta as telas do sistema; tela própria quando não há internet.
 * A sessão (cookies) fica salva entre aberturas do app.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var progresso: ProgressBar
    private lateinit var erro: View
    private lateinit var atualizador: AtualizadorApk
    /** quando o app foi para o segundo plano (0 = está na frente) */
    private var pausadoEm = 0L

    private val urlInicial: Uri = Uri.parse(BuildConfig.APP_URL)
    private val hostDoSistema: String = urlInicial.host.orEmpty()

    /** quem está esperando o arquivo escolhido (o WebView) e a foto que a câmera vai gravar */
    private var aguardandoArquivo: ValueCallback<Array<Uri>>? = null
    private var fotoDaCamera: Uri? = null
    private var falhouCarregar = false

    private val seletorDeArquivo =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { resultado ->
            val callback = aguardandoArquivo ?: return@registerForActivityResult
            aguardandoArquivo = null
            var arquivos: Array<Uri>? = null
            if (resultado.resultCode == RESULT_OK) {
                val dados = resultado.data
                val clip = dados?.clipData
                arquivos = when {
                    clip != null && clip.itemCount > 0 -> Array(clip.itemCount) { clip.getItemAt(it).uri }
                    dados?.data != null -> arrayOf(dados.data!!)
                    // a câmera grava no arquivo indicado e devolve o Intent vazio
                    fotoDaCamera != null -> arrayOf(fotoDaCamera!!)
                    else -> null
                }
            }
            fotoDaCamera = null
            // sempre responder (null = cancelado); senão o WebView não abre o seletor de novo
            callback.onReceiveValue(arquivos)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        progresso = findViewById(R.id.progresso)
        erro = findViewById(R.id.erro)
        findViewById<Button>(R.id.tentar).setOnClickListener { tentarDeNovo() }

        ajustarAsBordasDoCelular()
        configurarWebView()

        onBackPressedDispatcher.addCallback(this) {
            if (web.canGoBack()) {
                web.goBack()
            } else {
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
            }
        }

        // tocou numa notificação de lembrete: abre direto a tela dela
        val pedida = enderecoDoLembrete(intent)
        if (pedida != null) {
            web.loadUrl(pedida)
        } else if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(urlInicial.toString())
        }

        atualizador = AtualizadorApk(this)
        atualizador.verificar()

        // lembretes do checklist (08:00 e 08:30): agenda e pede a permissão de notificar (Android 13+)
        Lembretes.criarCanal(this)
        Lembretes.agendar(this)
        pedirPermissaoDeNotificar()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        enderecoDoLembrete(intent)?.let { web.loadUrl(it) }
    }

    /** Endereço da tela do lembrete (só caminhos do próprio sistema). */
    private fun enderecoDoLembrete(intent: Intent?): String? {
        val caminho = intent?.getStringExtra(Lembretes.EXTRA_ABRIR) ?: return null
        intent.removeExtra(Lembretes.EXTRA_ABRIR)
        if (!caminho.startsWith("/") || caminho.startsWith("//")) return null
        return BuildConfig.APP_URL.trimEnd('/') + caminho
    }

    private val permissaoDeNotificar =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { concedida ->
            if (concedida) Lembretes.agendar(this)
        }

    /** Pergunta uma vez só (se a pessoa negar, os lembretes ficam desligados até ela ligar nas configurações). */
    private fun pedirPermissaoDeNotificar() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || Lembretes.podeNotificar(this)) return
        val prefs = getSharedPreferences("lembretes", MODE_PRIVATE)
        if (prefs.getBoolean("permissao_pedida", false)) return
        prefs.edit().putBoolean("permissao_pedida", true).apply()
        permissaoDeNotificar.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        // voltou do segundo plano: a página confere se o sistema tem versão nova e recarrega sozinha
        if (pausadoEm > 0 && System.currentTimeMillis() - pausadoEm > VOLTA_MS) {
            web.evaluateJavascript("window.dispatchEvent(new Event('rodar:retomar'))", null)
        }
        pausadoEm = 0
        atualizador.aoRetomar()
        atualizador.verificar()
    }

    override fun onDestroy() {
        atualizador.encerrar()
        super.onDestroy()
    }

    /** O conteúdo nunca fica atrás da barra de status, do recorte da câmera ou do teclado. */
    private fun ajustarAsBordasDoCelular() {
        val raiz = findViewById<View>(R.id.raiz)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, raiz).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        ViewCompat.setOnApplyWindowInsetsListener(raiz) { view, insets ->
            val barras = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val teclado = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(barras.left, barras.top, barras.right, maxOf(barras.bottom, teclado.bottom))
            WindowInsetsCompat.CONSUMED
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configurarWebView() {
        web.setBackgroundColor(getColor(R.color.fundo))
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            // o layout segue a largura do celular (meta viewport do site); sem zoom de pinça
            useWideViewPort = true
            loadWithOverviewMode = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            // texto no tamanho do projeto: a fonte gigante do sistema quebraria o layout
            textZoom = 100
            mediaPlaybackRequiresUserGesture = true
            allowFileAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString FrotasApp/${BuildConfig.VERSION_NAME}"
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, false)
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                val doSistema = (uri.scheme == "https" || uri.scheme == "http") && uri.host == hostDoSistema
                if (doSistema) return false
                abrirFora(uri)
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                falhouCarregar = false
            }

            override fun onPageFinished(view: WebView, url: String?) {
                progresso.visibility = View.GONE
                if (!falhouCarregar) erro.visibility = View.GONE
                CookieManager.getInstance().flush()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    falhouCarregar = true
                    erro.visibility = View.VISIBLE
                }
            }

            // se o motor do WebView cair (pouca memória), reabre a tela em vez de fechar o app
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                recreate()
                return true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progresso.progress = newProgress
                progresso.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
            }

            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams,
            ): Boolean = abrirSeletorDeArquivo(filePathCallback, fileChooserParams)
        }

        // PDFs e demais downloads: o WebView não exibe, então abre no app do celular
        web.setDownloadListener { url, _, _, _, _ -> abrirFora(Uri.parse(url)) }
    }

    /**
     * <input type="file">: com `capture` (fotos do checklist e do cupom) abre direto a câmera;
     * sem ele, deixa escolher entre câmera, galeria e arquivos (CNH em PDF, por exemplo).
     */
    private fun abrirSeletorDeArquivo(
        callback: ValueCallback<Array<Uri>>,
        params: WebChromeClient.FileChooserParams,
    ): Boolean {
        aguardandoArquivo?.onReceiveValue(null)
        aguardandoArquivo = callback

        val tipos = params.acceptTypes
            .flatMap { it.split(',') }
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
        val aceitaImagem = tipos.isEmpty() || tipos.any { it.startsWith("image/") || it == "*/*" }
        val soImagem = tipos.isNotEmpty() && tipos.all { it.startsWith("image/") }
        val camera = if (aceitaImagem) intentDaCamera() else null

        val intent = if (params.isCaptureEnabled && soImagem && camera != null) {
            camera
        } else {
            val conteudo = Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = if (tipos.size == 1) tipos[0] else "*/*"
                if (tipos.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, tipos.toTypedArray())
                if (params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
            }
            Intent.createChooser(conteudo, getString(R.string.escolher_arquivo)).apply {
                if (camera != null) putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera))
            }
        }

        return try {
            seletorDeArquivo.launch(intent)
            true
        } catch (e: ActivityNotFoundException) {
            aguardandoArquivo = null
            fotoDaCamera = null
            callback.onReceiveValue(null)
            Toast.makeText(this, R.string.sem_app, Toast.LENGTH_SHORT).show()
            true
        }
    }

    /** Câmera do próprio celular gravando num arquivo do app (sem precisar da permissão CAMERA). */
    private fun intentDaCamera(): Intent? {
        return try {
            val pasta = File(cacheDir, "camera").apply { mkdirs() }
            pasta.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 86_400_000 }?.forEach { it.delete() }
            val arquivo = File.createTempFile("foto-", ".jpg", pasta)
            val uri = FileProvider.getUriForFile(this, "$packageName.arquivos", arquivo)
            fotoDaCamera = uri
            Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, uri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        } catch (e: Exception) {
            fotoDaCamera = null
            null
        }
    }

    /** WhatsApp (wa.me), telefone, e-mail, PDFs/fotos assinados e outros sites: app certo do celular. */
    private fun abrirFora(uri: Uri) {
        val intent = if (uri.scheme == "intent") {
            try {
                Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).apply {
                    // só abre como um link comum (nunca um componente interno de outro app)
                    addCategory(Intent.CATEGORY_BROWSABLE)
                    component = null
                    selector = null
                }
            } catch (e: Exception) {
                null
            }
        } else {
            Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
        }
        try {
            if (intent != null) startActivity(intent) else throw ActivityNotFoundException()
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, R.string.sem_app, Toast.LENGTH_SHORT).show()
        }
    }

    private fun tentarDeNovo() {
        erro.visibility = View.GONE
        if (web.url.isNullOrEmpty() || web.url == "about:blank") web.loadUrl(urlInicial.toString()) else web.reload()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        web.onPause()
        pausadoEm = System.currentTimeMillis()
        CookieManager.getInstance().flush()
    }

    private companion object {
        /** fora do app por mais que isso (ex.: abriu outro app) => confere a versão ao voltar */
        const val VOLTA_MS = 60_000L
    }
}
