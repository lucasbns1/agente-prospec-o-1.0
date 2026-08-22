/**
 * A etapa que anda pelo relógio.
 *
 * ============================================================
 * O QUE FOI PEDIDO, NAS PALAVRAS DE QUEM PEDIU
 * ============================================================
 * "Eu não quero que você analise essa mensagem 1 que ele me responder, e
 * só diante da mensagem dele, se for sim ou não, responda 2. Eu quero
 * que mande a primeira, aí depois dos minutos que eu configurar, mande a
 * mensagem 2 automaticamente. Aí a partir da mensagem 2, aí sim analise
 * a resposta."
 *
 * A abordagem e "Oi, prazer, me chamo Lucas." — uma mensagem curta cujo
 * proposito e provocar a saudacao automatica do WhatsApp Business. Fazer
 * a cadencia depender dessa resposta e o contrario do que ela serve.
 *
 * ============================================================
 * O QUE A CONFIGURACAO SOZINHA NAO RESOLVIA
 * ============================================================
 * Desmarcar "aguardar resposta" ja fazia a M2 sair no tempo. Mas as
 * regras da etapa continuavam rodando sobre a resposta, e uma delas e
 * `DUVIDA -> AGUARDAR_INTERVENCAO`. A saudacao automatica chegava, o
 * dicionario nao reconhecia, e o lead era congelado com um pedido de
 * intervencao antes de a conversa comecar.
 *
 * ============================================================
 * A LINHA QUE NAO SE ATRAVESSA
 * ============================================================
 * "Ignorar a resposta" e nao AVANCAR por causa dela e nao INCOMODAR o
 * operador por causa dela. Nunca e continuar mandando para quem pediu
 * para parar. O ultimo bloco deste arquivo existe so para isso.
 */
import { describe, expect, it } from 'vitest';
import { peneirarEfeitosSemEspera } from '../apps/worker/src/services/inbound.js';
import type { EfeitoDecisao } from '@prospector/domain';

/** Constrói um efeito com o mínimo que o filtro olha: o tipo. */
const efeito = (tipo: string): EfeitoDecisao => ({ tipo }) as unknown as EfeitoDecisao;

describe('a resposta não conduz a cadência', () => {
  it('não avança a etapa', () => {
    const r = peneirarEfeitosSemEspera([efeito('AVANCAR_ETAPA')]);
    expect(r).toEqual([]);
  });

  it('não dispara resposta automática por template', () => {
    const r = peneirarEfeitosSemEspera([efeito('ENVIAR_TEMPLATE')]);
    expect(r).toEqual([]);
  });

  it('não congela o lead pedindo intervenção', () => {
    // O caso concreto: a saudação automática do WhatsApp Business cai em
    // DUVIDA, e a regra da etapa 1 mandava AGUARDAR_INTERVENCAO.
    const r = peneirarEfeitosSemEspera([
      efeito('CRIAR_INTERVENCAO'),
      efeito('CRIAR_TAREFA'),
    ]);
    expect(r).toEqual([]);
  });

  it('não adia a sequência', () => {
    const r = peneirarEfeitosSemEspera([
      efeito('AGENDAR_SNOOZE'),
      efeito('AGUARDAR_RESPOSTA'),
    ]);
    expect(r).toEqual([]);
  });

  it('não mexe no status do lead', () => {
    // Sem a intervenção junto, um lead marcado AGUARDANDO_INTERVENCAO
    // ficaria esperando um aviso que nunca foi criado.
    const r = peneirarEfeitosSemEspera([efeito('ALTERAR_STATUS')]);
    expect(r).toEqual([]);
  });
});

describe('mas o registro continua', () => {
  it('temperatura e histórico passam', () => {
    // Nenhum dos dois muda o rumo de nada. Descartá-los só deixaria o
    // CRM cego sobre uma conversa que existiu.
    const r = peneirarEfeitosSemEspera([
      efeito('ALTERAR_TEMPERATURA'),
      efeito('REGISTRAR_EVENTO'),
    ]);
    expect(r.map((e) => e.tipo)).toEqual([
      'ALTERAR_TEMPERATURA',
      'REGISTRAR_EVENTO',
    ]);
  });
});

describe('PARAR sempre vale — inclusive aqui', () => {
  it('opt-out atravessa o filtro inteiro', () => {
    // Esta é a asserção mais importante do arquivo. Uma etapa
    // configurada para ignorar respostas NÃO pode virar um caminho pelo
    // qual o sistema continua mandando mensagem para quem pediu para
    // parar.
    const r = peneirarEfeitosSemEspera([
      efeito('REGISTRAR_OPT_OUT'),
      efeito('CANCELAR_JOBS_PENDENTES'),
      efeito('PARAR_SEQUENCIA'),
    ]);

    expect(r.map((e) => e.tipo)).toEqual([
      'REGISTRAR_OPT_OUT',
      'CANCELAR_JOBS_PENDENTES',
      'PARAR_SEQUENCIA',
    ]);
  });

  it('opt-out sobrevive misturado com tudo o que é descartado', () => {
    const r = peneirarEfeitosSemEspera([
      efeito('AVANCAR_ETAPA'),
      efeito('REGISTRAR_OPT_OUT'),
      efeito('CRIAR_INTERVENCAO'),
      efeito('PARAR_SEQUENCIA'),
      efeito('ENVIAR_TEMPLATE'),
    ]);

    expect(r.map((e) => e.tipo)).toEqual(['REGISTRAR_OPT_OUT', 'PARAR_SEQUENCIA']);
  });

  it('a lista de sobreviventes não cresce sem alguém decidir', () => {
    // Uma trava de revisão: se um efeito novo entrar na lista, este
    // teste falha e obriga a pergunta "ele PARA, ou ele CONDUZ?".
    const todos = [
      'ALTERAR_STATUS',
      'ALTERAR_TEMPERATURA',
      'REGISTRAR_OPT_OUT',
      'CANCELAR_JOBS_PENDENTES',
      'CRIAR_TAREFA',
      'CRIAR_INTERVENCAO',
      'REGISTRAR_EVENTO',
      'AGENDAR_SNOOZE',
      'PARAR_SEQUENCIA',
      'AVANCAR_ETAPA',
      'ENVIAR_TEMPLATE',
      'AGUARDAR_RESPOSTA',
    ].map(efeito);

    expect(peneirarEfeitosSemEspera(todos).map((e) => e.tipo)).toEqual([
      'ALTERAR_TEMPERATURA',
      'REGISTRAR_OPT_OUT',
      'CANCELAR_JOBS_PENDENTES',
      'REGISTRAR_EVENTO',
      'PARAR_SEQUENCIA',
    ]);
  });
});
