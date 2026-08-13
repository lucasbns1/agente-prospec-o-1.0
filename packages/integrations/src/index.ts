export * from './whatsapp/adapter.js';
export * from './whatsapp/fake-adapter.js';
export * from './whatsapp/factory.js';

// --- Canal WhatsApp Web (Fase 6A) ---
//
// `provedor-whatsapp-web.js` NAO e exportado de proposito: ele e o unico
// arquivo que importa a biblioteca, e reexporta-lo aqui abriria caminho
// para o resto do sistema alcançá-la. A factory faz o import dinamico.
export * from './whatsapp/guarda-envio.js';
export * from './whatsapp/eventos-canal.js';
export * from './whatsapp/provedor.js';
export * from './whatsapp/provedor-simulado.js';
export * from './whatsapp/whatsapp-web-adapter.js';
export * from './whatsapp/qr-imagem.js';
export * from './whatsapp/telefone-da-mensagem.js';

// --- Importacao (Fase 2) ---
export * from './import/parser.js';
export * from './import/column-mapping.js';

// --- Fontes de lead (Fase P) ---
export * from './sources/lead-source.js';
export * from './sources/arquivo-lead-source.js';
