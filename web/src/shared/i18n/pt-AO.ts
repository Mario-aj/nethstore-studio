// Todos os textos da interface, em português de Angola, tratamento por "tu".
// As frases que só fazem sentido na rede de casa têm uma variante para o modo
// público (docs/DECISOES.md, item 4); ver `deployText`.

export type DeployMode = 'lan' | 'public';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const t = {
  brand: 'NETHSTORE',
  brandSuffix: '· Estúdio',

  common: {
    loading: 'A carregar…',
    retry: 'Repetir',
    back: 'Voltar',
    close: 'Fechar',
    logout: 'Sair',
    connected: 'Ligado',
    disconnected: 'Desligado',
    photos: (n: number) => `${n} ${plural(n, 'foto', 'fotos')}`,
  },

  update: {
    title: 'Nova versão disponível',
    action: 'Atualizar',
    dismiss: 'Agora não',
  },

  notFound: {
    title: 'Página não encontrada',
    body: 'O endereço que abriste não existe no estúdio.',
    home: 'Voltar ao início',
  },

  landing: {
    nav: {
      how: 'Como funciona',
      stamp: 'O carimbo',
      install: 'Instalar',
      enter: 'Entrar',
      menu: 'Abrir menu',
      closeMenu: 'Fechar menu',
      label: 'Principal',
    },
    eyebrow: 'ESTÚDIO PRIVADO DA NETHSTORE',
    titleBefore: 'Do fardo à ',
    titleAccent: 'montra',
    titleAfter: ' em minutos.',
    lead: 'Sobe as fotos das peças, define o preço e o tamanho uma vez e o Estúdio carimba o grupo inteiro. Pronto para Instagram, Facebook e TikTok.',
    ctaEnter: 'Entrar no estúdio',
    ctaInstall: 'Instalar no telemóvel',
    heroProgress: 'A carimbar',
    heroProgressCount: '7 de 12',
    heroReady: 'Pronta',
    heroPhotoAlt: 'Vestido preto de bolinhas na manequim dourada, em frente ao painel da NethStore',
    heroCardAlt: 'Conjunto laranja na manequim, já carimbado',
    how: {
      eyebrow: 'COMO FUNCIONA',
      title: 'Três passos. Nenhuma edição à mão.',
      aside:
        'Um fardo dá entre 240 e 480 fotos. Em vez de escrever preço e tamanho em cada uma, fazes isso uma vez por grupo.',
      steps: [
        {
          n: '01',
          title: 'Escolhe as fotos',
          body: 'Até 50 fotos do mesmo grupo, da galeria ou direto da câmara.',
        },
        {
          n: '02',
          title: 'Define preço e tamanhos',
          body: 'Escreves o preço e marcas os tamanhos uma vez. Vale para o grupo todo.',
        },
        { n: '03', title: 'Guarda e publica', body: 'Guardas tudo na galeria e partilhas onde vendes.' },
      ],
      stripLabel: 'Fotos do lote',
    },
    stamp: {
      eyebrow: 'O CARIMBO',
      title: 'O carimbo de sempre, sem o trabalho de sempre.',
      body: 'As clientes já conhecem este carimbo. O Estúdio escreve-o igual em todas as fotos.',
      compareLabel: 'Comparação da mesma foto: à esquerda com carimbo, à direita sem',
      sliderLabel: 'Mover a divisória entre a foto com carimbo e sem carimbo',
      after: 'DEPOIS',
      before: 'ANTES',
      rules: [
        { term: 'POSIÇÃO', value: 'Canto superior esquerdo', hint: '' },
        { term: 'LINHA 1', value: 'Descrição/ Tamanhos', hint: '· Veste/ M e L' },
        { term: 'LINHA 2', value: 'Preço', hint: '· 10.000 kz', accent: true },
        { term: 'SEM DESCRIÇÃO', value: 'Só os tamanhos', hint: '· M e L' },
        { term: 'TAMANHOS', value: 'XS, S, M, L, XL e 2XL', hint: '' },
        { term: 'ESTILO', value: 'Texto preto, sem fundo', hint: '' },
      ],
    },
    install: {
      eyebrow: 'INSTALAR',
      title: 'Fica no ecrã do telemóvel, como uma app.',
      step2Title: 'Toca no menu ⋮ e escolhe Instalar app',
      step2Body: 'O ícone do Estúdio aparece no ecrã inicial.',
      step3Title: 'Entra uma vez com a tua chave',
      step3Body: 'O telemóvel fica lembrado durante 30 dias.',
    },
    final: { before: 'Pronta para o próximo ', accent: 'fardo', after: '?' },
    footer: { city: 'Luanda', private: 'Acesso privado' },
  },

  login: {
    title: 'Bem-vinda.',
    subtitle: 'A tua chave abre o estúdio.',
    label: 'Chave de acesso',
    placeholder: '32 caracteres',
    show: 'Mostrar chave',
    hide: 'Esconder chave',
    paste: 'Colar',
    pasteFailed: 'Não deu para ler a área de transferência. Toca no campo e cola com o teclado.',
    helperEmpty: 'Pede a chave a quem instalou o estúdio.',
    helperTyping: (missing: number) =>
      `${plural(missing, 'Falta', 'Faltam')} ${missing} ${plural(missing, 'caracter', 'caracteres')}.`,
    helperIncomplete: (n: number) => `A chave tem 32 caracteres. Esta tem ${n}.`,
    helperInvalidChars: 'A chave só tem letras e números.',
    helperWrong: 'Chave errada.',
    helperWrongRemaining: (n: number) =>
      `Chave errada. ${plural(n, 'Resta', 'Restam')} ${n} ${plural(n, 'tentativa', 'tentativas')}.`,
    enter: 'Entrar',
    checking: 'A verificar',
    lockedTitle: 'Muitas tentativas',
    lockedBody: 'Espera um pouco antes de tentar outra vez.',
    lockedButton: (countdown: string) => `Tenta em ${countdown}`,
    reconnect: 'Tentar ligar outra vez',
    remember: 'Este telemóvel fica lembrado durante 30 dias.',
  },

  create: {
    eyebrow: (date: string) => `NOVO LOTE · ${date}`,
    title: 'Fotos e preço',
    emptyTitle: 'Ainda não há fotos',
    emptyBody: 'Até 50 fotos por grupo.',
    choose: 'Escolher fotos',
    camera: 'Tirar foto',
    add: 'Adicionar',
    addPhotos: 'Adicionar fotos',
    inBatch: (n: number) => `${plural(n, 'foto', 'fotos')} no lote`,
    seeAll: 'Ver todas',
    allTitle: (n: number) => `${n} ${plural(n, 'foto', 'fotos')} no lote`,
    allHint: 'Toca no x para tirar uma foto do lote. Máximo 50.',
    done: 'Concluir',
    removePhoto: (n: number) => `Tirar foto ${n} do lote`,
    photoAlt: (n: number) => `Foto ${n} do lote`,
    tooMany: (left: number) =>
      `Só cabem 50 fotos por grupo. ${left} ${plural(left, 'ficou', 'ficaram')} de fora.`,
    price: 'Preço',
    priceMissing: 'Escreve o preço para processar.',
    sizes: 'Tamanhos',
    sizesChoose: 'Escolher',
    description: 'Descrição · opcional',
    descriptionPlaceholder: 'Veste, Conjunto, Saia',
    descriptionTooLong: 'A descrição tem no máximo 24 caracteres.',
    descriptionInvalid: "Usa só letras, números e . , ' ( ) & +",
    stampLabel: 'Carimbo:',
    stampEmpty: 'escolhe fotos, preço e tamanhos',
    stampNoPrice: 'falta o preço',
    stampNoSizes: 'falta o tamanho',
    process: 'Processar fotos',
    processN: (n: number) => `Processar ${n} ${plural(n, 'foto', 'fotos')}`,
    creating: 'A criar o lote',
  },

  sheet: {
    title: 'Tamanhos',
    subtitle: 'Escolhe um ou mais.',
    preview: 'No carimbo',
    previewEmpty: 'escolhe um tamanho',
    clear: 'Limpar',
    apply: 'Aplicar',
  },

  processing: {
    header: (date: string) => `LOTE · ${date}`,
    ringLabel: 'Progresso do lote',
    count: (done: number, total: number) => `${done} de ${total} ${plural(total, 'foto', 'fotos')}`,
    paused: 'Em pausa',
    titleUploading: 'A enviar as fotos',
    titlePreparing: 'A preparar as imagens',
    titleStamping: 'A aplicar o carimbo',
    titleOffline: 'Sem ligação',
    titleOneFailed: 'Uma foto falhou',
    titleSomeFailed: (n: number) => `${n} fotos falharam`,
    titleAllFailed: 'As fotos falharam',
    msgUploading: 'Não feches o app enquanto as fotos sobem.',
    msgOthersReady: (n: number) =>
      `${plural(n, 'A outra', 'As outras')} ${n} ${plural(n, 'está pronta', 'estão prontas')}.`,
    msgNoneReady: 'Nenhuma foto ficou pronta. Tenta outra vez.',
    reconnectIn: (s: number) => `${s} s`,
    reconnected: 'Ligação de volta',
    reconnectedBody: (n: number, total: number) => `A retomar o envio da foto ${n} de ${total}.`,
    hiddenTitle: 'Saíste do app durante o envio',
    hiddenBody: 'O envio pode ter parado enquanto estavas fora. Mantém o app aberto até as fotos subirem.',
    steps: {
      upload: 'Enviar fotos',
      prepare: 'Preparar imagens',
      stamp: 'Aplicar preço e tamanho',
      ready: 'Pronto para guardar',
    },
    stepState: { pending: 'Pendente', loading: 'A carregar', completed: 'Concluído', error: 'Erro' },
    countPaused: (done: number, total: number) => `${done}/${total} · em pausa`,
    countFailed: (done: number, total: number, failed: number) =>
      `${done}/${total} · ${failed} ${plural(failed, 'falhou', 'falharam')}`,
    readyHeading: 'JÁ PRONTAS',
    readyEmpty: 'As fotos carimbadas aparecem aqui.',
    readyAlt: (n: number) => `Foto ${n}, carimbada`,
    failedAlt: (n: number) => `Foto ${n}, falhou`,
    failedRetry: (n: number) => `${n} ${plural(n, 'falhou', 'falharam')} · repetir`,
    continueWith: (n: number) => `Seguir com ${n}`,
    retryN: (n: number) => `Repetir ${n} ${plural(n, 'foto', 'fotos')}`,
    chooseAgain: (n: number) => `Escolher de novo ${plural(n, 'a foto', `as ${n} fotos`)}`,
    chooseAgainHint: (n: number) =>
      `${plural(n, 'Uma foto não chegou', `${n} fotos não chegaram`)} ao estúdio. Escolhe ${plural(n, 'essa foto', 'essas fotos')} outra vez para enviar.`,
    newGroup: 'Novo grupo',
    notFound: 'Este lote já não existe.',
  },

  ready: {
    title: 'Prontas',
    summary: (total: number) => `de ${total} ${plural(total, 'foto carimbada', 'fotos carimbadas')}`,
    gridLabel: 'Fotos carimbadas',
    failuresLabel: 'Fotos com erro',
    failedTitle: (n: number) => `${n} ${plural(n, 'foto falhou', 'fotos falharam')}`,
    failedLine: (positions: string, n: number, reason: string) =>
      `${plural(n, 'Foto', 'Fotos')} ${positions} · ${reason}`,
    reasons: {
      upload: 'a foto não foi enviada',
      prepare: 'a imagem não foi preparada',
      stamp: 'o carimbo não foi aplicado',
      invalid_image: 'a imagem não é válida',
      mixed: 'não ficaram prontas',
    },
    save: 'Guardar todas na galeria',
    saving: (n: number, total: number) => `A guardar ${n} de ${total}`,
    saved: 'Guardadas na galeria',
    share: 'Partilhar',
    shareNext: (n: number) => `Partilhar as próximas ${n}`,
    shareUnsupported:
      'Este telemóvel não deixa partilhar fotos daqui. Guarda na galeria e partilha a partir dela.',
    shareFailed: 'Não deu para partilhar. Tenta outra vez.',
    saveFailed: 'Não deu para guardar todas as fotos. Tenta outra vez.',
    newGroup: 'Novo grupo',
  },

  errors: {
    network: 'Sem ligação ao estúdio. Confirma a ligação e tenta outra vez.',
    invalid_json: 'O pedido saiu com um formato errado. Tenta outra vez.',
    invalid_format: 'A chave só tem letras e números, 32 ao todo.',
    invalid_price: 'O preço tem de ficar entre 1 e 9.999.999 kz.',
    invalid_sizes: 'Escolhe pelo menos um tamanho.',
    invalid_description: "A descrição tem até 24 caracteres: letras, números e . , ' ( ) & +",
    invalid_photo_count: 'Um grupo tem de 1 a 50 fotos.',
    invalid_id: 'Este endereço não é válido.',
    unauthenticated: 'A tua sessão terminou. Entra outra vez.',
    invalid_secret: 'Chave errada.',
    forbidden_origin: 'Pedido recusado. Abre o estúdio pelo endereço habitual.',
    not_found: 'Não encontrámos o que procuras.',
    not_ready: 'Esta foto ainda não está pronta.',
    method_not_allowed: 'Pedido não suportado.',
    object_missing: 'A foto não chegou ao estúdio. Tenta enviar outra vez.',
    invalid_object_size: 'A foto é demasiado grande ou demasiado pequena.',
    invalid_state: 'Esta foto já mudou de estado. Atualiza a página.',
    payload_too_large: 'O pedido é demasiado grande.',
    unsupported_media_type: 'O pedido saiu com um formato errado.',
    too_many_attempts: 'Muitas tentativas. Espera um pouco antes de tentar outra vez.',
    too_many_open_batches: 'Já tens 5 grupos com fotos por enviar. Termina um deles antes de começar outro.',
    internal: 'Algo correu mal no estúdio. Tenta outra vez.',
    storage_unavailable: 'O armazenamento das fotos não está a responder. Tenta daqui a pouco.',
    unknown: 'Algo correu mal. Tenta outra vez.',
  } satisfies Record<string, string>,

  photoErrors: {
    upload_failed: 'a foto não foi enviada',
    upload_expired: 'o envio ficou a meio',
    invalid_image: 'a imagem não é válida',
    processing_failed: 'o processamento falhou',
  } satisfies Record<string, string>,
};

/** Frases que dependem de o estúdio correr no computador de casa ou num servidor. */
export function deployText(mode: DeployMode) {
  if (mode === 'public') {
    return {
      heroNote: 'Corre num servidor privado da loja. Só entra quem tem a chave.',
      installStep1Title: 'Abre o endereço no Chrome',
      installStep1Body: (host: string) => `O endereço do Estúdio é ${host}.`,
      loginChecking: 'A confirmar a chave.',
      loginOfflineTitle: 'Estúdio fora de alcance',
      loginOfflineBody: 'Confirma que tens internet e tenta outra vez.',
      processingCalm: 'Podes bloquear o telemóvel. O servidor continua.',
      offlineTitle: 'Perdeste a ligação ao estúdio',
      offlineBody: 'Retomamos sozinhos quando a internet voltar. A tentar outra vez em',
    };
  }
  return {
    heroNote: 'Corre no computador de casa. As fotos não saem da tua rede.',
    installStep1Title: 'Abre o endereço no Chrome, no Wi-Fi de casa',
    installStep1Body: (host: string) => `O endereço é o do computador onde o Estúdio corre: ${host}.`,
    loginChecking: 'A confirmar com o computador de casa.',
    loginOfflineTitle: 'Computador fora de alcance',
    loginOfflineBody: 'Confirma que estás no Wi-Fi de casa e que o computador está ligado.',
    processingCalm: 'Podes bloquear o telemóvel. O computador continua.',
    offlineTitle: 'Perdeste a ligação ao computador',
    offlineBody: 'Retomamos sozinhos quando voltares ao Wi-Fi de casa. A tentar outra vez em',
  };
}

export type ErrorCode = keyof typeof t.errors;

export function errorMessage(code: string): string {
  return code in t.errors ? t.errors[code as ErrorCode] : t.errors.unknown;
}

export function photoErrorText(code: string | null | undefined): string | null {
  if (!code) return null;
  return code in t.photoErrors ? t.photoErrors[code as keyof typeof t.photoErrors] : null;
}
