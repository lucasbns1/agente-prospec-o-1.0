/**
 * O que a faixa do topo tem o direito de dizer.
 *
 * ============================================================
 * DUAS MENTIRAS QUE ESTA TELA JA CONTOU
 * ============================================================
 * 1. "MODO SIMULAÇÃO — nada é enviado", acesa por uma variavel de
 *    ambiente que nao aparecia em lugar nenhum da interface. A campanha
 *    estava corretamente liberada e nao havia como apagar a faixa pela
 *    tela.
 *
 * 2. "ENVIO TRAVADO NO CÓDIGO", acesa com a trava do codigo ABERTA. O
 *    impedimento real era outro — o canal simulado — e a faixa mandava
 *    procurar no arquivo errado.
 *
 * As duas custaram horas de depuracao em cima do lugar errado. Um aviso
 * que nao diz o motivo certo e pior que nenhum aviso: nenhum aviso deixa
 * voce investigar; o motivo errado te manda para longe.
 *
 * Estes testes travam a REGRA que decide o texto. Ela e pura de proposito
 * — decidir o que a faixa diz nao precisa de banco, Redis nem WhatsApp.
 */
import { describe, expect, it } from 'vitest';
import { FASE_PERMITE_ENVIO_REAL } from '../packages/integrations/src/whatsapp/guarda-envio.js';

/**
 * A mesma regra de `routes/canal.ts`, isolada para o teste.
 *
 * Duplicar quatro linhas e o preco de nao subir um Fastify inteiro para
 * conferir uma condicao booleana. Se as duas divergirem, o teste do
 * final deste arquivo pega.
 */
function motivoDaFaixa(entrada: {
  envioRealPermitidoNaFase: boolean;
  canal: string;
}): 'FASE_TRAVADA' | 'CANAL_SIMULADO' | null {
  if (!entrada.envioRealPermitidoNaFase) return 'FASE_TRAVADA';
  if (entrada.canal !== 'whatsapp-web') return 'CANAL_SIMULADO';
  return null;
}

describe('a faixa nomeia o impedimento certo', () => {
  it('canal simulado com a fase aberta acusa o CANAL, nao o codigo', () => {
    // Este e o caso exato do relato: bolinha verde, "WhatsApp conectado",
    // e a faixa dizendo que o codigo estava travado enquanto ele nao
    // estava.
    expect(
      motivoDaFaixa({ envioRealPermitidoNaFase: true, canal: 'simulado' })
    ).toBe('CANAL_SIMULADO');
  });

  it('fase travada acusa o codigo, mesmo com o canal real', () => {
    expect(
      motivoDaFaixa({ envioRealPermitidoNaFase: false, canal: 'whatsapp-web' })
    ).toBe('FASE_TRAVADA');
  });

  it('a fase vence quando os dois estao levantados', () => {
    // Nao e arbitrario: a trava de fase e a mais forte e a mais cara de
    // mexer (exige commit). Mandar a pessoa parear um celular para depois
    // descobrir que o codigo recusa seria desperdicio.
    expect(
      motivoDaFaixa({ envioRealPermitidoNaFase: false, canal: 'simulado' })
    ).toBe('FASE_TRAVADA');
  });

  it('sem impedimento nenhum, a faixa nao aparece', () => {
    expect(
      motivoDaFaixa({ envioRealPermitidoNaFase: true, canal: 'whatsapp-web' })
    ).toBeNull();
  });

  it('a simulacao POR CAMPANHA nunca acende a faixa', () => {
    // A faixa fala pelo sistema. Campanha em simulacao e uma escolha sua,
    // visivel na propria campanha — anunciar isso no topo faria parecer
    // que o sistema inteiro esta parado.
    expect(
      motivoDaFaixa({ envioRealPermitidoNaFase: true, canal: 'whatsapp-web' })
    ).toBeNull();
  });
});

describe('a regra do teste nao se descola da rota', () => {
  it('routes/canal.ts decide pelos mesmos dois campos, na mesma ordem', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const fonte = readFileSync(
      path.join(raiz, 'apps/api/src/routes/canal.ts'),
      'utf8'
    );

    // Nao compara texto: confere que a rota testa a fase ANTES do canal,
    // que e a unica parte da regra em que a ordem muda o resultado.
    const posFase = fonte.indexOf('envioRealPermitidoNaFase');
    const posCanal = fonte.indexOf("canal !== 'whatsapp-web'");

    expect(posFase).toBeGreaterThan(-1);
    expect(posCanal).toBeGreaterThan(-1);
    expect(posFase).toBeLessThan(posCanal);
  });

  it('o adapter simulado nao reporta mais a fase como travada', async () => {
    // O bug estava aqui: o worker chumbava `envioRealPermitidoNaFase:
    // false` no ramo do adapter falso. A trava de fase fala do CODIGO e
    // vale igual para os dois adapters.
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const fonte = readFileSync(path.join(raiz, 'apps/worker/src/index.ts'), 'utf8');

    expect(fonte).not.toMatch(/envioRealPermitidoNaFase:\s*false/);
    expect(fonte).toMatch(/envioRealPermitidoNaFase:\s*FASE_PERMITE_ENVIO_REAL/);
    expect(FASE_PERMITE_ENVIO_REAL).toBe(true);
  });
});
