/**
 * O fallback deixou de congelar tudo — e o que ele ainda recusa.
 *
 * ============================================================
 * O QUE MUDOU, E POR QUE
 * ============================================================
 * Quando o Gemini não responde, o orquestrador cai no motor
 * determinístico. Até aqui, QUALQUER ação que enviasse virava
 * intervenção: seguro, e caro. Um timeout de 30 segundos virou rotina, e
 * cada um congelava um lead que o motor saberia conduzir sozinho.
 *
 * O motor não é chute. Ele classifica contra um dicionário de centenas
 * de termos, com confiança, e as regras de cada etapa são as que o
 * operador configurou na tela. Ignorar isso é jogar fora a resposta que
 * o sistema tem para dar.
 *
 * ============================================================
 * A PARTE QUE NÃO AFROUXOU
 * ============================================================
 * Três recusas continuam de pé, e o terceiro bloco deste arquivo existe
 * só para elas. Nenhuma é configurável para menos.
 */
import { describe, expect, it } from 'vitest';
import {
  respostaPermiteAvancar,
  CONFIANCA_MINIMA_DO_MOTOR,
} from '../packages/domain/src/index.js';

/** As regras que o usuário tem configuradas hoje, do diagnóstico real. */
const REGRAS_REAIS = [
  { categoria: 'OPT_OUT', acao: 'PARAR' },
  { categoria: 'NEGATIVO', acao: 'PARAR' },
  { categoria: 'FALAR_DEPOIS', acao: 'AGUARDAR_INTERVENCAO' },
  { categoria: 'PRECO', acao: 'AGUARDAR_INTERVENCAO' },
  { categoria: 'DUVIDA', acao: 'AGUARDAR_INTERVENCAO' },
  { categoria: 'POSITIVO', acao: 'AVANCAR' },
  { categoria: 'INTERESSE', acao: 'AGUARDAR_INTERVENCAO' },
];

const resp = (categoriaDoMotor: string, confiancaDoMotor: number) => ({
  categoriaDoMotor,
  confiancaDoMotor,
});

describe('o motor conduz quando a regra manda avançar', () => {
  it('POSITIVO com confiança alta libera a próxima mensagem', () => {
    // O caso que antes congelava sem motivo: o lead disse "quero sim",
    // o motor entendeu com 95, a regra manda AVANCAR — e o sistema
    // parava porque o Gemini estava lento.
    expect(respostaPermiteAvancar(resp('POSITIVO', 95), REGRAS_REAIS)).toEqual({
      permite: true,
    });
  });

  it('"Sim" com 70 de confiança também passa', () => {
    // O valor real que o dicionário dá para "Sim", visto no diagnóstico.
    expect(respostaPermiteAvancar(resp('POSITIVO', 70), REGRAS_REAIS)).toEqual({
      permite: true,
    });
  });

  it('IR_PARA_ETAPA também é avanço', () => {
    const r = respostaPermiteAvancar(resp('POSITIVO', 80), [
      { categoria: 'POSITIVO', acao: 'IR_PARA_ETAPA' },
    ]);
    expect(r.permite).toBe(true);
  });

  it('sem resposta nenhuma, esta regra não opina', () => {
    // Quem decide se a sequência anda no silêncio é o relógio, mais
    // acima. Bloquear aqui pararia toda cadência automática.
    expect(respostaPermiteAvancar(undefined, REGRAS_REAIS)).toEqual({
      permite: true,
    });
  });
});

describe('a regra da etapa é obedecida, não adivinhada', () => {
  it('PRECO vira intervenção porque é o que a regra manda', () => {
    const r = respostaPermiteAvancar(resp('PRECO', 90), REGRAS_REAIS);

    expect(r.permite).toBe(false);
    if (!r.permite) {
      expect(r.acao).toBe('CREATE_INTERVENTION');
      expect(r.motivo).toContain('PRECO');
    }
  });

  it('DUVIDA e FALAR_DEPOIS também chamam você', () => {
    for (const c of ['DUVIDA', 'FALAR_DEPOIS']) {
      const r = respostaPermiteAvancar(resp(c, 90), REGRAS_REAIS);
      expect(r.permite).toBe(false);
      if (!r.permite) expect(r.acao).toBe('CREATE_INTERVENTION');
    }
  });

  it('SNOOZE não é avanço', () => {
    // "Adiar" tratado como "pode enviar" seria inverter a instrução.
    const r = respostaPermiteAvancar(resp('POSITIVO', 90), [
      { categoria: 'POSITIVO', acao: 'SNOOZE' },
    ]);
    expect(r.permite).toBe(false);
  });

  it('NENHUMA não é avanço', () => {
    const r = respostaPermiteAvancar(resp('POSITIVO', 90), [
      { categoria: 'POSITIVO', acao: 'NENHUMA' },
    ]);
    expect(r.permite).toBe(false);
  });
});

describe('as três recusas que não afrouxaram', () => {
  it('1. OPT_OUT para, mesmo sem regra configurada', () => {
    const semRegras = respostaPermiteAvancar(resp('OPT_OUT', 99), []);

    expect(semRegras.permite).toBe(false);
    if (!semRegras.permite) expect(semRegras.acao).toBe('STOP_CAMPAIGN');
  });

  it('1b. NEGATIVO para, mesmo com uma regra mandando avançar', () => {
    // Não existe leitura de "não quero" que autorize a próxima mensagem.
    // Uma regra mal configurada não pode virar essa porta.
    const r = respostaPermiteAvancar(resp('NEGATIVO', 99), [
      { categoria: 'NEGATIVO', acao: 'AVANCAR' },
    ]);

    expect(r.permite).toBe(false);
    if (!r.permite) expect(r.acao).toBe('STOP_CAMPAIGN');
  });

  it('2. confiança baixa vira intervenção, mesmo com regra de AVANCAR', () => {
    // Do diagnóstico real: "ok" classifica POSITIVO com 35. Pode ser
    // "ok, manda" ou "ok, deixa pra lá" — e a diferença entre as duas é
    // uma mensagem enviada para quem não queria.
    const r = respostaPermiteAvancar(resp('POSITIVO', 35), REGRAS_REAIS);

    expect(r.permite).toBe(false);
    if (!r.permite) {
      expect(r.acao).toBe('CREATE_INTERVENTION');
      expect(r.motivo).toContain('35');
    }
  });

  it('2b. o piso é exatamente 50 — 49 recusa, 50 passa', () => {
    expect(respostaPermiteAvancar(resp('POSITIVO', 49), REGRAS_REAIS).permite).toBe(
      false
    );
    expect(respostaPermiteAvancar(resp('POSITIVO', 50), REGRAS_REAIS).permite).toBe(
      true
    );
    expect(CONFIANCA_MINIMA_DO_MOTOR).toBe(50);
  });

  it('3. categoria sem regra pergunta em vez de inventar', () => {
    // DESCONHECIDO não está nas regras do usuário — e não deve virar
    // avanço por omissão.
    const r = respostaPermiteAvancar(resp('DESCONHECIDO', 80), REGRAS_REAIS);

    expect(r.permite).toBe(false);
    if (!r.permite) {
      expect(r.acao).toBe('CREATE_INTERVENTION');
      expect(r.motivo).toContain('Nao ha regra configurada');
    }
  });

  it('uma etapa SEM regra nenhuma não vira porta aberta', () => {
    // Campanha recém-criada, antes de configurar regras: tudo pergunta.
    for (const c of ['POSITIVO', 'PRECO', 'DUVIDA', 'INTERESSE']) {
      expect(respostaPermiteAvancar(resp(c, 99), []).permite).toBe(false);
    }
  });
});
