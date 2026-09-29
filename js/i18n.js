// Languages: Brazilian Portuguese and English. Every text the player reads comes from here: the page
// (elements marked data-i18n*), menus, settings, HUD, map, car descriptions and the road signs (whose
// Japanese line stays; the line under it follows the language).
// The language is picked from the browser on the first visit (Portuguese for pt-*, English otherwise)
// and can be changed in Settings › Game; changing it applies at once, signs included.

export const LANGS = ['pt', 'en'];
let lang = 'pt';
const listeners = [];

export function detectLang() {
  const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']).map(l => String(l).toLowerCase());
  for (const l of list) {
    if (l.startsWith('pt')) return 'pt';
    if (l.startsWith('en')) return 'en';
  }
  return 'en';
}
// setting: 'auto' | 'pt' | 'en'
export const resolveLang = setting => (LANGS.includes(setting) ? setting : detectLang());
export const getLang = () => lang;
export function setLang(l) {
  l = LANGS.includes(l) ? l : 'pt';
  const changed = l !== lang;
  lang = l;
  document.documentElement.lang = l === 'pt' ? 'pt-BR' : 'en';
  applyDom();
  if (changed) for (const f of listeners) f(l);
}
export const onLangChange = f => listeners.push(f);

export function t(key, vars) {
  let s = DICT[lang][key];
  if (s === undefined) s = DICT.pt[key];
  if (s === undefined) return key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : '')) : s;
}

// page text: data-i18n (textContent), data-i18n-html (markup), data-i18n-aria (aria-label),
// data-i18n-content (meta content)
export function applyDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-content]')) el.setAttribute('content', t(el.dataset.i18nContent));
}

// decimal comma in Portuguese
export const num = (v, digits = 1) => { const s = Number(v).toFixed(digits); return lang === 'pt' ? s.replace('.', ',') : s; };

// place names: the network keeps the romanised English name as the key
const ZONES_PT = {
  'Minato Bayside': 'Baía de Minato', 'Kaigan Bridge': 'Ponte Kaigan', 'Shiodome Curve': 'Curva Shiodome',
  'Higashi Downtown': 'Centro Higashi', 'Kita Junction': 'Entroncamento Kita', 'Kita Tunnel': 'Túnel Kita',
  'Nishi Industrial': 'Polo Industrial Nishi', 'Nishi Straight': 'Reta Nishi', 'Nishi PA': 'Estacionamento Nishi',
};
export const zoneName = name => (lang === 'pt' && ZONES_PT[name]) || name;

const DICT = {
  pt: {
    'meta.desc': 'Passeio noturno em 3D pelas vias expressas elevadas de uma Tóquio fictícia.',
    'load.lights': 'Acendendo as luzes da cidade…',
    'load.road': 'Traçando a via expressa…',
    'load.city': 'Erguendo a cidade…',
    'load.cars': 'Trazendo os carros para a garagem…',
    'load.lamps': 'Acendendo os postes…',
    'load.traffic': 'Colocando o trânsito na pista…',
    'load.shaders': 'Preparando os gráficos…',
    'load.webgl': 'Não foi possível iniciar o WebGL neste navegador. Tente atualizar a página ou usar outro navegador.',
    'title.tag': 'Anel K1, meia-noite. Sem corrida e sem missão: escolha um carro, entre na via expressa e dirija.',
    'title.play': 'Jogar', 'title.settings': 'Configurações', 'title.credits': 'Créditos',
    'sel.paint': 'Cor', 'sel.paintAria': 'Cor do carro', 'sel.cars': 'Veículos',
    'sel.hint': '<span><kbd>←</kbd> <kbd>→</kbd> trocar</span><span>arraste para girar</span><span><kbd>Enter</kbd> dirigir</span><span><kbd>Esc</kbd> voltar</span>',
    'sel.back': 'Voltar', 'sel.go': 'Dirigir',
    'stat.top': 'Vel. máxima', 'stat.grip': 'Aderência', 'stat.rear': 'Traseira', 'stat.mass': 'Peso',
    'grip.high': 'alta', 'grip.mid': 'média', 'grip.low': 'baixa',
    'rear.loose': 'solta', 'rear.neutral': 'neutra', 'rear.firm': 'firme',
    'map.aria': 'Mapa da via expressa', 'map.title': 'Mapa', 'map.sub': 'Anel K1 · Estacionamento Nishi',
    'map.keys': '<span><kbd>Roda do mouse</kbd> zoom</span><span><kbd>Arrastar</kbd> mover</span><span><kbd>C</kbd> centralizar no carro</span><span><kbd>M</kbd> / <kbd>Esc</kbd> fechar</span>',
    'map.you': 'Você', 'map.ring': 'Anel K1', 'map.tunnel': 'Túnel', 'map.pa': 'Estacionamento (PA)', 'map.zones': 'Regiões',
    'cred.title': 'Créditos', 'cred.sub': 'Modelos 3D dos carros',
    'cred.foot': 'Modelos otimizados (texturas e malhas comprimidas) e adaptados para o jogo. Nomes e marcas pertencem aos respectivos fabricantes.',
    'cred.by': 'por {author} · licença ',
    'close': 'Fechar',
    'pause.title': 'Pausa', 'pause.resume': 'Continuar', 'pause.car': 'Trocar de carro', 'pause.reset': 'Voltar para a pista',
    'pause.settings': 'Configurações', 'pause.menu': 'Menu inicial', 'pause.keys': 'Comandos',
    'pause.info': '{car} · {km} km rodados',
    'keys.action': 'Ação', 'keys.keyboard': 'Teclado', 'keys.pad': 'Controle',
    'set.title': 'Configurações', 'set.reset': 'Restaurar padrões',
    'tab.graphics': 'Gráficos', 'tab.display': 'Tela', 'tab.audio': 'Áudio', 'tab.controls': 'Controles', 'tab.gameplay': 'Jogo',
    'opt.quality': 'Qualidade gráfica', 'q.auto': 'Automática', 'q.low': 'Baixa', 'q.medium': 'Média', 'q.high': 'Alta', 'q.ultra': 'Ultra', 'q.max': 'Máxima',
    'q.custom': 'Personalizada: ajustes individuais abaixo.', 'q.detected': 'Detectada para este computador: {q}.',
    'opt.renderDist': 'Distância de visão', 'opt.shadows': 'Sombras', 'opt.textures': 'Texturas',
    'opt.effects': 'Efeitos e reflexos', 'opt.effectsNote': 'Brilho das luzes, reflexos no asfalto e iluminação dinâmica dos postes.',
    'off.f': 'Desligadas', 'off.m': 'Desligados', 'fx.basic': 'Básicos', 'fx.full': 'Completos',
    'opt.traffic': 'Quantidade de trânsito', 'opt.fps': 'Limite de FPS', 'fps.none': 'Sem limite',
    'fps.note': '{hz} Hz detectados. O limite se ajusta ao monitor para os quadros ficarem uniformes.',
    'vsync.text': 'Sempre ativo: o navegador sincroniza os quadros com a taxa do monitor.',
    'opt.display': 'Modo de exibição', 'disp.window': 'Janela', 'disp.full': 'Tela cheia',
    'opt.res': 'Resolução interna', 'res.native': 'Nativa',
    'res.note': 'Tela atual: {w}×{h} · densidade {d}×. O navegador não deixa mudar a resolução do monitor; esta opção muda a resolução com que o jogo é desenhado.',
    'opt.master': 'Volume geral', 'opt.engine': 'Motor', 'opt.sfx': 'Efeitos', 'opt.sfxNote': 'Pneus, buzina, batidas, setas e ultrapassagens.',
    'opt.ambient': 'Ambiente', 'opt.ambientNote': 'Vento, trânsito e cidade.',
    'opt.lang': 'Idioma', 'lang.auto': 'Automático', 'lang.pt': 'Português', 'lang.en': 'English',
    'lang.note': 'Automático segue o idioma do navegador. As placas da estrada também mudam.',
    'opt.units': 'Unidade de velocidade', 'opt.minimap': 'Minimapa', 'opt.hud': 'HUD', 'opt.mirror': 'Retrovisor',
    'opt.camDist': 'Distância da câmera', 'opt.camSmooth': 'Resposta da câmera', 'opt.camSmoothNote': 'Mais alta: a câmera acompanha as curvas mais depressa.',
    'opt.vibration': 'Vibração do controle', 'vib.ok': 'Funciona em controles com vibração suportada pelo navegador.', 'vib.no': 'Não suportada neste navegador.',
    'ctl.key': '{name}: tecla {n}', 'ctl.pressKey': 'Tecla…', 'ctl.padBtn': '{name}: botão do controle', 'ctl.pressBtn': 'Botão…',
    'ctl.removeKb': 'Remover {name} do teclado', 'ctl.removePad': 'Remover {name} do controle',
    'ctl.help': 'Clique numa tecla ou botão e aperte o novo. <kbd>Del</kbd> apaga, <kbd>Esc</kbd> cancela, ✕ remove o comando.',
    'ctl.reset': 'Restaurar controles',
    'act.accel': 'Acelerar', 'act.brake': 'Frear / Ré', 'act.left': 'Virar à esquerda', 'act.right': 'Virar à direita', 'act.horn': 'Buzina',
    'act.lights': 'Faróis', 'act.lookLeft': 'Olhar à esquerda', 'act.lookRight': 'Olhar à direita', 'act.camera': 'Câmera',
    'act.lookback': 'Olhar para trás', 'act.reset': 'Voltar para a pista', 'act.map': 'Mapa', 'act.pause': 'Pausa',
    'pad.stick': 'Analógico', 'pad.guide': 'Guia', 'pad.button': 'Botão {n}',
    'key.space': 'Espaço', 'key.shiftR': 'Shift dir.', 'key.ctrlR': 'Ctrl dir.',
    'toast.go': '{car}: boa viagem!', 'toast.lightsOn': 'Faróis ligados', 'toast.lightsOff': 'Faróis desligados',
    'toast.cam': ['Câmera: atrás do carro', 'Câmera: perto', 'Câmera: longe', 'Câmera: capô'].join('|'),
    'toast.reset': 'De volta à faixa', 'toast.noFull': 'Tela cheia indisponível aqui', 'toast.autoQ': 'Qualidade ajustada automaticamente: {q}',
    'paint.0': 'Branco', 'paint.1': 'Preto', 'paint.2': 'Azul', 'paint.3': 'Vermelho', 'paint.4': 'Verde', 'paint.5': 'Amarelo', 'paint.6': 'Rosa',
    'cls.gt': 'Gran turismo', 'cls.drift': 'Drift', 'cls.sports': 'Esportivo', 'cls.super': 'Superesportivo', 'cls.classic': 'Clássico',
    'car.r32': 'O Godzilla original. Tração integral e dois turbos: cola nas curvas e não para de puxar.',
    'car.nsx': 'V6 central que gira alto. Leve e preciso: o carro mais certeiro da garagem.',
    'car.tiara83': 'Cupê leve dos anos 80, tração traseira e motor que grita. Lendário nas descidas de serra.',
    // road signs (the line under the Japanese)
    'sign.inner': 'Anel interno', 'sign.outer': 'Anel externo', 'sign.pa': 'Estacionamento Nishi',
    'sign.exit': 'SAÍDA', 'sign.uturn': 'Retorno', 'sign.noEntry': 'PROIBIDO ENTRAR', 'sign.notExit': 'NÃO É SAÍDA',
    // premium pack
    'car.p_r34': 'O Skyline do Brian: seis em linha biturbo, tração integral e o prata com as faixas azuis mais famoso das telas.',
    'car.p_rx7': 'O RX-7 do Julius: motor rotativo que grita alto, leve e nervoso na saída das curvas.',
    'car.p_eclipse': 'O Eclipse verde neon do primeiro filme: turbo, gráficos de corrida e muita atitude.',
    'car.p_s15': 'A S15 "Mona Lisa" de Tóquio: nasceu para derrapar, com kit C-West e o azul com laranja mais cobiçado do drift.',
    'car.p_supra2': 'A Supra do Slap Jack: seis em linha turbo, forte do meio para cima e com pintura que ninguém esquece.',
    'car.p_s2000': 'O S2000 rosa da Suki: conversível leve, motor que gira alto e curvas na ponta dos dedos.',
    'car.p_supra': 'A Supra laranja que virou lenda: seis em linha biturbo e força de sobra em qualquer reta.',
    'shop.loading': 'Carregando o carro…', 'shop.loadFail': 'Não foi possível carregar o carro. Verifique a conexão.',
    // yen (in-game money, earned by driving; no real money anywhere)
    'coins.lockLine': 'Premium · {price} · você tem {bal}', 'coins.lockGuest': 'Premium · {price}',
    'coins.buy': 'Comprar · {price}', 'coins.confirm': 'Confirmar · {price}', 'coins.short': 'Faltam {missing}',
    'coins.signInBtn': 'Entrar para comprar', 'coins.signIn': 'Entre na sua conta (ou crie uma) para ganhar ienes dirigindo e comprar carros.',
    'coins.confirmHint': 'Aperte de novo para comprar o {car}.', 'coins.notEnough': 'Ienes insuficientes para este carro.',
    'coins.notEnoughHint': 'Faltam {missing}. Dirija para ganhar: ¥ 1 a cada 10 m, e o bônus de cruzeiro sobe quanto mais tempo você roda sem parar.',
    'coins.bought': '{car} é seu! Saldo: {bal}.', 'coins.earned': '+{n}', 'coins.bonus': 'Cruzeiro ×{x}',
    // online
    'title.online': 'Online', 'pause.leaveOnline': 'Sair do online',
    'on.title': 'Online', 'on.sub': 'Dirija com outros jogadores',
    'on.lead': 'Salas de até 20 jogadores rodando juntos pela via expressa. Você vê o carro e o nome de cada um.',
    'on.needAccount': 'O online é para quem tem conta: entre (ou crie uma) para jogar com os outros.', 'on.login': 'Entrar',
    'on.auto': 'Sala pública', 'on.autoDesc': 'Entra numa sala com gente rodando agora',
    'on.create': 'Criar sala privada', 'on.createDesc': 'Gera um código para chamar os amigos',
    'on.joinCode': 'Entrar com código', 'on.code': 'Código da sala', 'on.enter': 'Entrar',
    'on.badCode': 'O código tem 6 letras ou números.', 'on.note': 'Sem colisão entre jogadores; o trânsito é de cada um.',
    'on.joined': 'Online na sala {room} · {n} jogando', 'on.joinedPrivate': 'Sala privada {room}: passe o código para os amigos · {n} jogando',
    'on.playerIn': '{name} entrou na sala', 'on.playerOut': '{name} saiu da sala', 'on.reconnecting': 'Conexão caiu, reconectando…',
    'on.left': 'Você saiu do online', 'on.badge': 'Online · {room} · {n}', 'on.badgeConnecting': 'Online · conectando…',
    'on.err.auth': 'Não foi possível confirmar sua conta. Entre de novo.', 'on.err.car': 'Esse carro não é seu.',
    'on.err.elsewhere': 'Sua conta entrou no online em outra aba.', 'on.err.full': 'A sala está cheia (20 jogadores).',
    'on.err.net': 'Não foi possível conectar ao online. Tente de novo.',
    'cred.legal': 'Termos e privacidade',
    // account
    'acc.premiumBadge': 'Coleção completa', 'acc.statCoins': 'Ienes', 'acc.garage': 'Garagem', 'acc.favCar': 'Último carro:',
    'acc.settingsSec': 'Dados da conta e segurança',
    'acc.rank1': 'Novato do K1', 'acc.rank2': 'Motorista noturno', 'acc.rank3': 'Veterano da via expressa', 'acc.rank4': 'Lenda do K1',
    'acc.locale': 'pt-BR', 'acc.signInBtn': 'Entrar', 'acc.profileBtn': 'Perfil',
    'acc.title.login': 'Entrar', 'acc.title.signup': 'Criar conta', 'acc.title.forgot': 'Esqueci a senha', 'acc.title.reset': 'Nova senha',
    'acc.title.sent': 'Veja seu e-mail', 'acc.title.profile': 'Perfil', 'acc.title.delete': 'Excluir conta',
    'acc.lead': 'Sem conta você joga normalmente. Com uma conta, suas configurações e estatísticas ficam salvas e seguem você em qualquer aparelho.',
    'acc.email': 'E-mail', 'acc.password': 'Senha', 'acc.password2': 'Repita a senha', 'acc.newPassword': 'Nova senha', 'acc.curPassword': 'Senha atual',
    'acc.username': 'Nome de usuário', 'acc.nameRule': '3 a 20 caracteres: letras, números e _',
    'acc.nameNote': '3 a 20 caracteres: letras, números e _ · pode trocar uma vez por dia',
    'acc.nameFree': 'Disponível', 'acc.nameTaken': 'Esse nome já está em uso',
    'acc.passRule': 'Pelo menos 8 caracteres, com letras e números.',
    'acc.signIn': 'Entrar', 'acc.signUp': 'Criar conta', 'acc.signOut': 'Sair', 'acc.forgotLink': 'Esqueci a senha', 'acc.signupLink': 'Criar conta',
    'acc.haveAccount': 'Já tenho conta', 'acc.back': 'Voltar', 'acc.cancel': 'Cancelar', 'acc.save': 'Salvar', 'acc.sendLink': 'Enviar link',
    'acc.savePassword': 'Salvar senha', 'acc.changePassword': 'Alterar senha', 'acc.deleteBtn': 'Excluir conta', 'acc.deleteConfirm': 'Excluir para sempre',
    'acc.forgotLead': 'Digite o e-mail da conta. Enviaremos um link para criar uma nova senha.',
    'acc.resetLead': 'Escolha a nova senha da sua conta.',
    'acc.deleteLead': 'A conta e todos os dados dela (estatísticas, configurações salvas) serão apagados para sempre. Para confirmar, digite o seu nome de usuário e a sua senha.',
    'acc.sentSignup': 'Enviamos um link de confirmação para {email}. Abra o e-mail e confirme para ativar a conta.',
    'acc.sentReset': 'Se existir uma conta com {email}, enviamos um link para criar uma nova senha.',
    'acc.sentHint': 'Não chegou? Veja a caixa de spam. O link vale por 1 hora.',
    'acc.statDist': 'Distância', 'acc.statTime': 'Tempo dirigindo', 'acc.statDrives': 'Viagens', 'acc.since': 'Membro desde', 'acc.seen': 'Último acesso',
    'acc.wait': 'Um momento…', 'acc.confirmed': 'E-mail confirmado. Bem-vindo ao Night Cruise!', 'acc.passChanged': 'Senha alterada.',
    'acc.nameSaved': 'Nome de usuário salvo.', 'acc.signedOut': 'Você saiu da conta.', 'acc.deleted': 'Conta excluída.',
    'acc.linkExpired': 'Esse link expirou. Peça um novo.', 'acc.linkInvalid': 'Esse link não é válido. Peça um novo.',
    'acc.err.credentials': 'E-mail ou senha incorretos.', 'acc.err.notConfirmed': 'Confirme seu e-mail antes de entrar (veja a caixa de entrada).',
    'acc.err.weak': 'Senha fraca: use pelo menos 8 caracteres, com letras e números.', 'acc.err.samePassword': 'A nova senha precisa ser diferente da atual.',
    'acc.err.rate': 'Muitas tentativas. Espere um pouco e tente de novo.', 'acc.err.captcha': 'Confirme a verificação anti-robô e tente de novo.',
    'acc.err.nameTaken': 'Esse nome de usuário já está em uso.', 'acc.err.nameCooldown': 'O nome de usuário só pode ser trocado uma vez por dia.',
    'acc.err.nameInvalid': 'Nome de usuário inválido: 3 a 20 caracteres, letras, números e _.', 'acc.err.reauth': 'Por segurança, digite sua senha de novo.',
    'acc.err.mismatch': 'As senhas não são iguais.', 'acc.err.deleteName': 'O nome de usuário digitado não confere.',
    'acc.err.network': 'Sem conexão com o servidor. Tente de novo.', 'acc.err.generic': 'Algo deu errado. Tente de novo.',
  },
  en: {
    'meta.desc': 'A 3D night drive on the elevated expressways of a fictional Tokyo.',
    'load.lights': 'Turning on the city lights…',
    'load.road': 'Laying out the expressway…',
    'load.city': 'Raising the city…',
    'load.cars': 'Bringing the cars into the garage…',
    'load.lamps': 'Switching on the street lamps…',
    'load.traffic': 'Putting the traffic on the road…',
    'load.shaders': 'Preparing the graphics…',
    'load.webgl': 'WebGL could not start in this browser. Try reloading the page or using another browser.',
    'title.tag': 'K1 loop, midnight. No race, no mission: pick a car, get on the expressway and drive.',
    'title.play': 'Play', 'title.settings': 'Settings', 'title.credits': 'Credits',
    'sel.paint': 'Colour', 'sel.paintAria': 'Car colour', 'sel.cars': 'Cars',
    'sel.hint': '<span><kbd>←</kbd> <kbd>→</kbd> switch</span><span>drag to rotate</span><span><kbd>Enter</kbd> drive</span><span><kbd>Esc</kbd> back</span>',
    'sel.back': 'Back', 'sel.go': 'Drive',
    'stat.top': 'Top speed', 'stat.grip': 'Grip', 'stat.rear': 'Rear end', 'stat.mass': 'Weight',
    'grip.high': 'high', 'grip.mid': 'medium', 'grip.low': 'low',
    'rear.loose': 'loose', 'rear.neutral': 'neutral', 'rear.firm': 'planted',
    'map.aria': 'Expressway map', 'map.title': 'Map', 'map.sub': 'K1 loop · Nishi PA',
    'map.keys': '<span><kbd>Wheel</kbd> zoom</span><span><kbd>Drag</kbd> pan</span><span><kbd>C</kbd> centre on car</span><span><kbd>M</kbd> / <kbd>Esc</kbd> close</span>',
    'map.you': 'You', 'map.ring': 'K1 loop', 'map.tunnel': 'Tunnel', 'map.pa': 'Parking area (PA)', 'map.zones': 'Districts',
    'cred.title': 'Credits', 'cred.sub': '3D car models',
    'cred.foot': 'Models optimised (compressed textures and meshes) and adapted for the game. Names and trademarks belong to their respective manufacturers.',
    'cred.by': 'by {author} · licence ',
    'close': 'Close',
    'pause.title': 'Paused', 'pause.resume': 'Resume', 'pause.car': 'Change car', 'pause.reset': 'Back on the road',
    'pause.settings': 'Settings', 'pause.menu': 'Main menu', 'pause.keys': 'Controls',
    'pause.info': '{car} · {km} km driven',
    'keys.action': 'Action', 'keys.keyboard': 'Keyboard', 'keys.pad': 'Controller',
    'set.title': 'Settings', 'set.reset': 'Restore defaults',
    'tab.graphics': 'Graphics', 'tab.display': 'Display', 'tab.audio': 'Audio', 'tab.controls': 'Controls', 'tab.gameplay': 'Game',
    'opt.quality': 'Graphics quality', 'q.auto': 'Automatic', 'q.low': 'Low', 'q.medium': 'Medium', 'q.high': 'High', 'q.ultra': 'Ultra', 'q.max': 'Maximum',
    'q.custom': 'Custom: individual settings below.', 'q.detected': 'Detected for this computer: {q}.',
    'opt.renderDist': 'View distance', 'opt.shadows': 'Shadows', 'opt.textures': 'Textures',
    'opt.effects': 'Effects and reflections', 'opt.effectsNote': 'Light glow, reflections on the asphalt and dynamic street lamp lighting.',
    'off.f': 'Off', 'off.m': 'Off', 'fx.basic': 'Basic', 'fx.full': 'Full',
    'opt.traffic': 'Traffic density', 'opt.fps': 'FPS limit', 'fps.none': 'Unlimited',
    'fps.note': '{hz} Hz detected. The limit follows the monitor so frames stay evenly paced.',
    'vsync.text': 'Always on: the browser syncs frames to the monitor refresh rate.',
    'opt.display': 'Display mode', 'disp.window': 'Window', 'disp.full': 'Full screen',
    'opt.res': 'Render resolution', 'res.native': 'Native',
    'res.note': 'Current screen: {w}×{h} · pixel ratio {d}×. Browsers cannot change the monitor resolution; this option changes the resolution the game renders at.',
    'opt.master': 'Master volume', 'opt.engine': 'Engine', 'opt.sfx': 'Effects', 'opt.sfxNote': 'Tyres, horn, impacts, indicators and passing cars.',
    'opt.ambient': 'Ambience', 'opt.ambientNote': 'Wind, traffic and city.',
    'opt.lang': 'Language', 'lang.auto': 'Automatic', 'lang.pt': 'Português', 'lang.en': 'English',
    'lang.note': 'Automatic follows the browser language. Road signs change too.',
    'opt.units': 'Speed unit', 'opt.minimap': 'Minimap', 'opt.hud': 'HUD', 'opt.mirror': 'Rear-view mirror',
    'opt.camDist': 'Camera distance', 'opt.camSmooth': 'Camera response', 'opt.camSmoothNote': 'Higher: the camera follows the curves more quickly.',
    'opt.vibration': 'Controller vibration', 'vib.ok': 'Works on controllers whose vibration the browser supports.', 'vib.no': 'Not supported in this browser.',
    'ctl.key': '{name}: key {n}', 'ctl.pressKey': 'Key…', 'ctl.padBtn': '{name}: controller button', 'ctl.pressBtn': 'Button…',
    'ctl.removeKb': 'Remove {name} from the keyboard', 'ctl.removePad': 'Remove {name} from the controller',
    'ctl.help': 'Click a key or button, then press the new one. <kbd>Del</kbd> clears, <kbd>Esc</kbd> cancels, ✕ removes the command.',
    'ctl.reset': 'Restore controls',
    'act.accel': 'Accelerate', 'act.brake': 'Brake / Reverse', 'act.left': 'Steer left', 'act.right': 'Steer right', 'act.horn': 'Horn',
    'act.lights': 'Headlights', 'act.lookLeft': 'Look left', 'act.lookRight': 'Look right', 'act.camera': 'Camera',
    'act.lookback': 'Look back', 'act.reset': 'Back on the road', 'act.map': 'Map', 'act.pause': 'Pause',
    'pad.stick': 'Stick', 'pad.guide': 'Guide', 'pad.button': 'Button {n}',
    'key.space': 'Space', 'key.shiftR': 'Right Shift', 'key.ctrlR': 'Right Ctrl',
    'toast.go': '{car}: enjoy the drive!', 'toast.lightsOn': 'Headlights on', 'toast.lightsOff': 'Headlights off',
    'toast.cam': ['Camera: chase', 'Camera: close', 'Camera: far', 'Camera: bonnet'].join('|'),
    'toast.reset': 'Back in the lane', 'toast.noFull': 'Full screen not available here', 'toast.autoQ': 'Quality adjusted automatically: {q}',
    'paint.0': 'White', 'paint.1': 'Black', 'paint.2': 'Blue', 'paint.3': 'Red', 'paint.4': 'Green', 'paint.5': 'Yellow', 'paint.6': 'Pink',
    'cls.gt': 'Grand tourer', 'cls.drift': 'Drift', 'cls.sports': 'Sports car', 'cls.super': 'Supercar', 'cls.classic': 'Classic',
    'car.r32': 'The original Godzilla. All-wheel drive and twin turbos: it sticks to the corners and never stops pulling.',
    'car.nsx': 'A mid-engined V6 that loves to rev. Light and sharp: the most precise car in the garage.',
    'car.tiara83': 'A light 80s coupé, rear-wheel drive and a screaming engine. A legend on mountain descents.',
    'sign.inner': 'Inner Loop', 'sign.outer': 'Outer Loop', 'sign.pa': 'Nishi Parking Area',
    'sign.exit': 'EXIT', 'sign.uturn': 'U-turn', 'sign.noEntry': 'NO ENTRY', 'sign.notExit': 'NOT AN EXIT',
    // premium pack
    'car.p_r34': "Brian's Skyline: twin-turbo straight six, all-wheel drive and the most famous silver-and-blue on screen.",
    'car.p_rx7': "Julius's RX-7: a screaming rotary, light and eager out of every corner.",
    'car.p_eclipse': 'The neon-green Eclipse from the first film: turbo, race graphics and plenty of attitude.',
    'car.p_s15': 'The Tokyo "Mona Lisa" S15: born to drift, with a C-West kit and the most coveted blue and orange in drifting.',
    'car.p_supra2': "Slap Jack's Supra: turbo straight six, strong from the mid-range up, with a livery nobody forgets.",
    'car.p_s2000': "Suki's pink S2000: a light roadster with a high-revving engine and fingertip handling.",
    'car.p_supra': 'The orange Supra that became a legend: twin-turbo straight six and power to spare on any straight.',
    'shop.loading': 'Loading the car…', 'shop.loadFail': "Couldn't load the car. Check your connection.",
    // yen (in-game money, earned by driving; no real money anywhere)
    'coins.lockLine': 'Premium · {price} · you have {bal}', 'coins.lockGuest': 'Premium · {price}',
    'coins.buy': 'Buy · {price}', 'coins.confirm': 'Confirm · {price}', 'coins.short': '{missing} to go',
    'coins.signInBtn': 'Sign in to buy', 'coins.signIn': 'Sign in (or create an account) to earn yen by driving and buy cars.',
    'coins.confirmHint': 'Press again to buy the {car}.', 'coins.notEnough': 'Not enough yen for this car.',
    'coins.notEnoughHint': '{missing} to go. Drive to earn: ¥1 every 10 m, and the cruise bonus grows the longer you keep going.',
    'coins.bought': 'The {car} is yours! Balance: {bal}.', 'coins.earned': '+{n}', 'coins.bonus': 'Cruise ×{x}',
    // online
    'title.online': 'Online', 'pause.leaveOnline': 'Leave online',
    'on.title': 'Online', 'on.sub': 'Drive with other players',
    'on.lead': 'Rooms of up to 20 players cruising the expressway together. You see everyone\'s car and name.',
    'on.needAccount': 'Online is for players with an account: sign in (or create one) to play with others.', 'on.login': 'Sign in',
    'on.auto': 'Public room', 'on.autoDesc': 'Joins a room with people driving right now',
    'on.create': 'Create a private room', 'on.createDesc': 'Makes a code to invite your friends',
    'on.joinCode': 'Join with a code', 'on.code': 'Room code', 'on.enter': 'Join',
    'on.badCode': 'The code has 6 letters or digits.', 'on.note': 'No collisions between players; each player has their own traffic.',
    'on.joined': 'Online in room {room} · {n} driving', 'on.joinedPrivate': 'Private room {room}: share the code with your friends · {n} driving',
    'on.playerIn': '{name} joined the room', 'on.playerOut': '{name} left the room', 'on.reconnecting': 'Connection lost, reconnecting…',
    'on.left': 'You left online', 'on.badge': 'Online · {room} · {n}', 'on.badgeConnecting': 'Online · connecting…',
    'on.err.auth': "Couldn't confirm your account. Sign in again.", 'on.err.car': "That car isn't yours.",
    'on.err.elsewhere': 'Your account went online in another tab.', 'on.err.full': 'The room is full (20 players).',
    'on.err.net': "Couldn't connect to online. Try again.",
    'cred.legal': 'Terms and privacy',
    // account
    'acc.premiumBadge': 'Full collection', 'acc.statCoins': 'Yen', 'acc.garage': 'Garage', 'acc.favCar': 'Last car:',
    'acc.settingsSec': 'Account details and security',
    'acc.rank1': 'K1 rookie', 'acc.rank2': 'Night driver', 'acc.rank3': 'Expressway veteran', 'acc.rank4': 'K1 legend',
    'acc.locale': 'en-GB', 'acc.signInBtn': 'Sign in', 'acc.profileBtn': 'Profile',
    'acc.title.login': 'Sign in', 'acc.title.signup': 'Create account', 'acc.title.forgot': 'Forgot password', 'acc.title.reset': 'New password',
    'acc.title.sent': 'Check your e-mail', 'acc.title.profile': 'Profile', 'acc.title.delete': 'Delete account',
    'acc.lead': 'You can play without an account. With one, your settings and stats are saved and follow you on any device.',
    'acc.email': 'E-mail', 'acc.password': 'Password', 'acc.password2': 'Repeat password', 'acc.newPassword': 'New password', 'acc.curPassword': 'Current password',
    'acc.username': 'Username', 'acc.nameRule': '3 to 20 characters: letters, digits and _',
    'acc.nameNote': '3 to 20 characters: letters, digits and _ · can be changed once a day',
    'acc.nameFree': 'Available', 'acc.nameTaken': 'That name is taken',
    'acc.passRule': 'At least 8 characters, with letters and digits.',
    'acc.signIn': 'Sign in', 'acc.signUp': 'Create account', 'acc.signOut': 'Sign out', 'acc.forgotLink': 'Forgot password', 'acc.signupLink': 'Create account',
    'acc.haveAccount': 'I have an account', 'acc.back': 'Back', 'acc.cancel': 'Cancel', 'acc.save': 'Save', 'acc.sendLink': 'Send link',
    'acc.savePassword': 'Save password', 'acc.changePassword': 'Change password', 'acc.deleteBtn': 'Delete account', 'acc.deleteConfirm': 'Delete forever',
    'acc.forgotLead': "Enter your account's e-mail. We'll send a link to choose a new password.",
    'acc.resetLead': 'Choose the new password for your account.',
    'acc.deleteLead': 'The account and all its data (stats, saved settings) will be erased forever. To confirm, type your username and your password.',
    'acc.sentSignup': 'We sent a confirmation link to {email}. Open the e-mail and confirm to activate the account.',
    'acc.sentReset': 'If an account exists for {email}, we sent a link to choose a new password.',
    'acc.sentHint': "Didn't get it? Check the spam folder. The link is valid for 1 hour.",
    'acc.statDist': 'Distance', 'acc.statTime': 'Time driving', 'acc.statDrives': 'Drives', 'acc.since': 'Member since', 'acc.seen': 'Last seen',
    'acc.wait': 'One moment…', 'acc.confirmed': 'E-mail confirmed. Welcome to Night Cruise!', 'acc.passChanged': 'Password changed.',
    'acc.nameSaved': 'Username saved.', 'acc.signedOut': 'You signed out.', 'acc.deleted': 'Account deleted.',
    'acc.linkExpired': 'That link has expired. Ask for a new one.', 'acc.linkInvalid': 'That link is not valid. Ask for a new one.',
    'acc.err.credentials': 'Wrong e-mail or password.', 'acc.err.notConfirmed': 'Confirm your e-mail before signing in (check your inbox).',
    'acc.err.weak': 'Weak password: use at least 8 characters, with letters and digits.', 'acc.err.samePassword': 'The new password must differ from the current one.',
    'acc.err.rate': 'Too many attempts. Wait a little and try again.', 'acc.err.captcha': 'Complete the anti-bot check and try again.',
    'acc.err.nameTaken': 'That username is taken.', 'acc.err.nameCooldown': 'The username can only be changed once a day.',
    'acc.err.nameInvalid': 'Invalid username: 3 to 20 characters, letters, digits and _.', 'acc.err.reauth': 'For your security, type your password again.',
    'acc.err.mismatch': "The passwords don't match.", 'acc.err.deleteName': "The username you typed doesn't match.",
    'acc.err.network': "Can't reach the server. Try again.", 'acc.err.generic': 'Something went wrong. Try again.',
  },
};
