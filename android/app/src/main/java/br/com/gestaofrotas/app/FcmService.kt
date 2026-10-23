package br.com.gestaofrotas.app

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Recebe o push do servidor na hora (mesmo com o app fechado, no modo de economia de bateria ou
 * com o celular parado). A mensagem traz só dados; a notificação é montada aqui.
 */
class FcmService : FirebaseMessagingService() {

    override fun onMessageReceived(mensagem: RemoteMessage) {
        val d = mensagem.data
        val titulo = d["titulo"]?.takeIf { it.isNotBlank() } ?: return
        Lembretes.notificar(this, d["id"] ?: "push", titulo, d["texto"].orEmpty(), d["url"] ?: "/")
        PushRegistro.recebido(this)
    }

    /** O token mudou (reinstalação, restauração): registra de novo se já houver sessão. */
    override fun onNewToken(token: String) {
        PushRegistro.tokenMudou(this)
        PushRegistro.registrarComSessao(this)
    }
}
