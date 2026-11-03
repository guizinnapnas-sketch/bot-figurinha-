const http = require('http')
const pino = require('pino')
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys')
const { Sticker, StickerTypes } = require('wa-sticker-formatter')

http.createServer((req, res) => res.end('Bot ativo'))
  .listen(process.env.PORT || 3000)

process.on('unhandledRejection', e => console.log('Erro ignorado:', e?.message))
process.on('uncaughtException', e => console.log('Erro ignorado:', e?.message))

const NUMERO = (process.env.NUMERO || '').replace(/\D/g, '')

async function iniciar() {
  const { state, saveCreds } = await useMultiFileAuthState('sessao')
  const { version } = await fetchLatestBaileysVersion()
  const logger = pino({ level: 'silent' })

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: ['Ubuntu', 'Chrome', '20.0.04']
  })

  let pediuCodigo = false

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !pediuCodigo && !sock.authState.creds.registered && NUMERO) {
      pediuCodigo = true
      try {
        const codigo = await sock.requestPairingCode(NUMERO)
        console.log('CODIGO DE PAREAMENTO:', codigo)
      } catch (e) {
        console.log('Falha ao pedir codigo:', e.message)
      }
    }
    if (connection === 'open') console.log('Bot conectado!')
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      console.log('Conexao fechada, codigo:', code)
      if (code !== DisconnectReason.loggedOut) setTimeout(iniciar, 5000)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg?.message || msg.key.fromMe) return

    const jid = msg.key.remoteJid
    const m = msg.message
    const ehGrupo = jid.endsWith('@g.us')

    const texto = (
      m.conversation ||
      m.extendedTextMessage?.text ||
      m.imageMessage?.caption ||
      m.videoMessage?.caption || ''
    ).trim()

    const ehComando = /^[\/!]?(sticker|figurinha|s)$/i.test(texto)
    const citada = m.extendedTextMessage?.contextInfo?.quotedMessage
    const temMidia = m.imageMessage || m.videoMessage

    let alvo = null
    if (temMidia && (ehComando || !ehGrupo)) {
      alvo = msg
    } else if (ehComando && (citada?.imageMessage || citada?.videoMessage)) {
      alvo = {
        key: { remoteJid: jid, id: m.extendedTextMessage.contextInfo.stanzaId },
        message: citada
      }
    }
    if (!alvo) return

    try {
      const buffer = await downloadMediaMessage(alvo, 'buffer', {}, {
        logger,
        reuploadRequest: sock.updateMediaMessage
      })
      const figurinha = new Sticker(buffer, {
        pack: 'Figurinhas',
        author: 'Meu Bot',
        type: StickerTypes.FULL,
        quality: 60
      })
      await sock.sendMessage(jid, { sticker: await figurinha.toBuffer() }, { quoted: msg })
    } catch (e) {
      console.log('Erro:', e.message)
      await sock.sendMessage(jid, { text: 'Não consegui criar a figurinha 😕' })
    }
  })
}

iniciar()
