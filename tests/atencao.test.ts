/**
 * Priorizacao da secao "precisa da sua atencao".
 *
 * Esta e a unica parte do dashboard que exige acao, e a ordem dela e uma
 * decisao de produto. Um teste que so verificasse "a lista tem 3 itens"
 * nao protegeria nada; o que importa e QUEM vem primeiro e por que.
 */
import { describe, expect, it } from 'vitest';
import {
  priorizarAtencao,
  PRIORIDADE_ATENCAO,
  ACAO_ATENCAO,
  type CandidatoAtencao,
  type MotivoAtencao,
} from '../packages/domain/src/dashboard/atencao.js';

let seq = 0;

function candidato(
  motivo: MotivoAtencao,
  extras: Partial<CandidatoAtencao> = {}
): CandidatoAtencao {
  seq += 1;
  return {
    leadId: extras.leadId ?? `lead-${seq}`,
    nome: `Lead ${seq}`,
    categoria: 'Psicólogo',
    bairro: 'Centro',
    cidade: 'Campinas',
    temperatura: 'FRIO',
    status: 'IMPORTADO',
    motivo,
    ultimaMensagem: null,
    etapaAtual: null,
    em: new Date('2026-08-13T10:00:00Z'),
    ...extras,
  };
}

describe('priorizarAtencao — ordem', () => {
  it('intervenção necessária vem antes de tudo', () => {
    const r = priorizarAtencao([
      candidato('ERRO_ENVIO'),
      candidato('LEAD_QUENTE'),
      candidato('INTERVENCAO_NECESSARIA'),
      candidato('PEDIDO_PRECO'),
    ]);

    expect(r[0]?.motivo).toBe('INTERVENCAO_NECESSARIA');
  });

  it('respeita a escala inteira', () => {
    const motivos: MotivoAtencao[] = [
      'ERRO_ENVIO',
      'TAREFA_ATRASADA',
      'PEDIDO_PRECO',
      'PEDIDO_PREVIEW',
      'LEAD_QUENTE',
      'INTERVENCAO_NECESSARIA',
    ];
    const r = priorizarAtencao(motivos.map((m) => candidato(m)));

    expect(r.map((i) => i.motivo)).toEqual([
      'INTERVENCAO_NECESSARIA',
      'LEAD_QUENTE',
      'PEDIDO_PREVIEW',
      'PEDIDO_PRECO',
      'TAREFA_ATRASADA',
      'ERRO_ENVIO',
    ]);
  });

  /**
   * Quem chegou primeiro é atendido primeiro. Sem isso, um lead antigo
   * ficaria no fim da lista para sempre, empurrado por cada novo caso da
   * mesma urgência.
   */
  it('dentro da mesma urgência, quem espera há mais tempo vem antes', () => {
    const antigo = candidato('LEAD_QUENTE', {
      leadId: 'antigo',
      em: new Date('2026-08-01T09:00:00Z'),
    });
    const recente = candidato('LEAD_QUENTE', {
      leadId: 'recente',
      em: new Date('2026-08-13T09:00:00Z'),
    });

    const r = priorizarAtencao([recente, antigo]);
    expect(r.map((i) => i.leadId)).toEqual(['antigo', 'recente']);
  });
});

describe('priorizarAtencao — um lead aparece uma vez só', () => {
  it('não duplica o lead que se qualifica por vários motivos', () => {
    const r = priorizarAtencao([
      candidato('LEAD_QUENTE', { leadId: 'mesmo' }),
      candidato('TAREFA_ATRASADA', { leadId: 'mesmo' }),
      candidato('ERRO_ENVIO', { leadId: 'mesmo' }),
    ]);

    expect(r).toHaveLength(1);
  });

  it('mantém o motivo mais urgente, não o primeiro que apareceu', () => {
    const r = priorizarAtencao([
      candidato('ERRO_ENVIO', { leadId: 'mesmo' }),
      candidato('INTERVENCAO_NECESSARIA', { leadId: 'mesmo' }),
      candidato('TAREFA_ATRASADA', { leadId: 'mesmo' }),
    ]);

    expect(r[0]?.motivo).toBe('INTERVENCAO_NECESSARIA');
  });

  it('conta os motivos que ficaram de fora, para não sumirem', () => {
    const r = priorizarAtencao([
      candidato('LEAD_QUENTE', { leadId: 'a' }),
      candidato('TAREFA_ATRASADA', { leadId: 'a' }),
      candidato('ERRO_ENVIO', { leadId: 'a' }),
      candidato('LEAD_QUENTE', { leadId: 'b' }),
    ]);

    expect(r.find((i) => i.leadId === 'a')?.totalMotivos).toBe(3);
    expect(r.find((i) => i.leadId === 'b')?.totalMotivos).toBe(1);
  });
});

describe('priorizarAtencao — forma do resultado', () => {
  it('traduz o motivo em uma ação legível', () => {
    const r = priorizarAtencao([candidato('PEDIDO_PREVIEW')]);
    expect(r[0]?.acaoNecessaria).toBe('Criar o preview');
  });

  it('todo motivo tem uma ação escrita', () => {
    for (const motivo of Object.keys(PRIORIDADE_ATENCAO) as MotivoAtencao[]) {
      expect(ACAO_ATENCAO[motivo]).toMatch(/\S/);
    }
  });

  it('serializa a data como ISO — o JSON da API não carrega Date', () => {
    const r = priorizarAtencao([
      candidato('LEAD_QUENTE', { em: new Date('2026-08-13T10:00:00Z') }),
    ]);
    expect(r[0]?.em).toBe('2026-08-13T10:00:00.000Z');
  });

  it('respeita o limite', () => {
    const muitos = Array.from({ length: 50 }, () => candidato('LEAD_QUENTE'));
    expect(priorizarAtencao(muitos, { limite: 5 })).toHaveLength(5);
  });

  it('corta pelo limite DEPOIS de ordenar — o mais urgente nunca fica de fora', () => {
    const candidatos = [
      ...Array.from({ length: 30 }, () => candidato('ERRO_ENVIO')),
      candidato('INTERVENCAO_NECESSARIA', { leadId: 'urgente' }),
    ];

    const r = priorizarAtencao(candidatos, { limite: 3 });
    expect(r[0]?.leadId).toBe('urgente');
  });

  it('lista vazia devolve lista vazia', () => {
    expect(priorizarAtencao([])).toEqual([]);
  });
});
