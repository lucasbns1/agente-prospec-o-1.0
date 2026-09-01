export * from './whatsapp/adapter.js';
export * from './whatsapp/fake-adapter.js';
export * from './whatsapp/factory.js';

// --- Canal WhatsApp Web (Fase 6A) ---
//
// `provedor-whatsapp-web.js` e `provedor-baileys.js` NAO sao exportados
// de proposito: cada um e o unico arquivo que importa a sua biblioteca, e
// reexporta-los aqui abriria caminho para o resto do sistema alcançá-las.
// A factory faz o import dinamico do que o canal escolher.
//
// `baileys-traducao.js` SAI daqui, porque e o contrario: funcao pura, sem
// nenhum import da biblioteca, e e onde moram as decisoes que erram na
// pratica (qual campo vira telefone, o que fazer com `@lid`).
export * from './whatsapp/guarda-envio.js';
export * from './whatsapp/eventos-canal.js';
export * from './whatsapp/provedor.js';
export * from './whatsapp/provedor-simulado.js';
export * from './whatsapp/whatsapp-web-adapter.js';
export * from './whatsapp/qr-imagem.js';
export * from './whatsapp/telefone-da-mensagem.js';
export * from './whatsapp/procurar-enviada.js';
export * from './whatsapp/baileys-traducao.js';

// --- Importacao (Fase 2) ---
export * from './import/parser.js';
export * from './import/column-mapping.js';

// --- Fontes de lead (Fase P) ---
export * from './sources/lead-source.js';
export * from './sources/arquivo-lead-source.js';

// --- Analise por IA (Fase 9) ---
//
// `gemini.js` NAO e exportado aqui, pelo mesmo motivo do
// `provedor-whatsapp-web.js`: ele e o unico arquivo que importa a SDK do
// Google, e reexporta-lo abriria caminho para o resto do sistema
// alcanca-la. Quem precisa dele importa pelo caminho completo — hoje so
// o worker.
export * from './ai/analisador.js';
export * from './ai/factory.js';
