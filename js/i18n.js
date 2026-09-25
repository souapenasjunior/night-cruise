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
    'sel.hint': '<span><kbd>←</kbd> <kbd>→</kbd> trocar</span><span><kbd>1</kbd>–<kbd>7</kbd> cor</span><span>arraste para girar</span><span><kbd>Enter</kbd> dirigir</span><span><kbd>Esc</kbd> voltar</span>',
    'sel.back': 'Voltar', 'sel.go': 'Dirigir',
    'stat.top': 'Vel. máxima', 'stat.grip': 'Aderência', 'stat.rear': 'Traseira', 'stat.mass': 'Peso',
    'grip.high': 'alta', 'grip.mid': 'média', 'grip.low': 'baixa',
    'rear.loose': 'solta', 'rear.neutral': 'neutra', 'rear.firm': 'firme',
    'map.aria': 'Mapa da via expressa', 'map.title': 'Mapa', 'map.sub': 'Anel K1 · Estacionamento Nishi',
    'map.keys': '<span><kbd>Roda do mouse</kbd> zoom</span><span><kbd>Arrastar</kbd> mover</span><span><kbd>C</kbd> centralizar no carro</span><span><kbd>M</kbd> / <kbd>Esc</kbd> fechar</span>',
    'map.you': 'Você', 'map.ring': 'Anel K1', 'map.tunnel': 'Túnel', 'map.pa': 'Estacionamento (PA)', 'map.zones': 'Regiões',
    'cred.title': 'Créditos', 'cred.sub': 'Modelos 3D dos carros · licença CC BY 4.0',
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
    'opt.music': 'Música do menu', 'opt.musicNote': 'Toca no menu inicial e na escolha do carro.',
    'cred.music': 'Música do menu',
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
    'car.s13': 'Leve, tração traseira e turbo: a escola do drift. A traseira escorrega com um toque.',
    'car.s14': 'A Silvia dos anos 90: entre-eixos maior, mais estável que a S13 e ainda feita para derrapar.',
    'car.z350': 'V6 aspirado com ronco encorpado. Equilibrado, previsível e forte na saída das curvas.',
    'car.nsx': 'V6 central que gira alto. Leve e preciso: o carro mais certeiro da garagem.',
    'car.tiara83': 'Cupê leve dos anos 80, tração traseira e motor que grita. Lendário nas descidas de serra.',
    // road signs (the line under the Japanese)
    'sign.inner': 'Anel interno', 'sign.outer': 'Anel externo', 'sign.pa': 'Estacionamento Nishi',
    'sign.exit': 'SAÍDA', 'sign.uturn': 'Retorno', 'sign.noEntry': 'PROIBIDO ENTRAR', 'sign.notExit': 'NÃO É SAÍDA',
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
    'sel.hint': '<span><kbd>←</kbd> <kbd>→</kbd> switch</span><span><kbd>1</kbd>–<kbd>7</kbd> colour</span><span>drag to rotate</span><span><kbd>Enter</kbd> drive</span><span><kbd>Esc</kbd> back</span>',
    'sel.back': 'Back', 'sel.go': 'Drive',
    'stat.top': 'Top speed', 'stat.grip': 'Grip', 'stat.rear': 'Rear end', 'stat.mass': 'Weight',
    'grip.high': 'high', 'grip.mid': 'medium', 'grip.low': 'low',
    'rear.loose': 'loose', 'rear.neutral': 'neutral', 'rear.firm': 'planted',
    'map.aria': 'Expressway map', 'map.title': 'Map', 'map.sub': 'K1 loop · Nishi PA',
    'map.keys': '<span><kbd>Wheel</kbd> zoom</span><span><kbd>Drag</kbd> pan</span><span><kbd>C</kbd> centre on car</span><span><kbd>M</kbd> / <kbd>Esc</kbd> close</span>',
    'map.you': 'You', 'map.ring': 'K1 loop', 'map.tunnel': 'Tunnel', 'map.pa': 'Parking area (PA)', 'map.zones': 'Districts',
    'cred.title': 'Credits', 'cred.sub': '3D car models · CC BY 4.0 licence',
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
    'opt.music': 'Menu music', 'opt.musicNote': 'Plays on the main menu and the car select screen.',
    'cred.music': 'Menu music',
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
    'car.s13': 'Light, rear-wheel drive and turbocharged: the drift school. The rear steps out with a touch.',
    'car.s14': 'The 90s Silvia: a longer wheelbase, steadier than the S13 and still built to slide.',
    'car.z350': 'Naturally aspirated V6 with a full-bodied growl. Balanced, predictable and quick out of corners.',
    'car.nsx': 'A mid-engined V6 that loves to rev. Light and sharp: the most precise car in the garage.',
    'car.tiara83': 'A light 80s coupé, rear-wheel drive and a screaming engine. A legend on mountain descents.',
    'sign.inner': 'Inner Loop', 'sign.outer': 'Outer Loop', 'sign.pa': 'Nishi Parking Area',
    'sign.exit': 'EXIT', 'sign.uturn': 'U-turn', 'sign.noEntry': 'NO ENTRY', 'sign.notExit': 'NOT AN EXIT',
  },
};
