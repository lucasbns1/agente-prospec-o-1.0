/**
 * Testes de deduplicacao e do pipeline completo de normalizacao de lead.
 *
 * O caso mais importante aqui: o MESMO estabelecimento importado uma vez
 * com telefone e outra sem. As chaves primarias sao diferentes (telefone
 * vs nome+endereco), entao so a comparacao por chaves secundarias pega.
 */
import { describe, expect, it } from 'vitest';
import {
  calcularChaveDedupe,
  calcularChavesSecundarias,
} from '../packages/domain/src/normalization/dedupe.js';
import { normalizarLead } from '../packages/domain/src/normalization/lead.js';
import type { DominioSocial } from '../packages/domain/src/normalization/website.js';

const SOCIAIS: DominioSocial[] = [
  { dominio: 'instagram.com', incluirSubdominios: true, ativo: true },
  { dominio: 'facebook.com', incluirSubdominios: true, ativo: true },
];

const opcoes = { dominiosSociais: SOCIAIS, ddiPadrao: '55' };

const vazio = {
  telefoneNormalizado: null, nomeCompleto: null, enderecoOriginal: null,
  logradouro: null, numero: null, cidade: null,
};

describe('calcularChaveDedupe — prioridades', () => {
  it('prioridade 1: telefone vence tudo', () => {
    const r = calcularChaveDedupe({
      ...vazio,
      telefoneNormalizado: '5519999998888',
      nomeCompleto: 'Maria', cidade: 'Campinas',
    });
    expect(r.criterio).toBe('TELEFONE');
  });

  it('prioridade 2: nome + endereco quando nao ha telefone', () => {
    const r = calcularChaveDedupe({
      ...vazio,
      nomeCompleto: 'Maria Silva',
      enderecoOriginal: 'R. Ferreira Penteado, 123',
      cidade: 'Campinas',
    });
    expect(r.criterio).toBe('NOME_ENDERECO');
  });

  it('prioridade 3: nome + cidade quando nao ha endereco', () => {
    const r = calcularChaveDedupe({
      ...vazio, nomeCompleto: 'Maria Silva', cidade: 'Campinas',
    });
    expect(r.criterio).toBe('NOME_CIDADE');
  });

  it('sem base confiavel devolve chave nula', () => {
    expect(calcularChaveDedupe(vazio).chave).toBeNull();
    expect(calcularChaveDedupe({ ...vazio, nomeCompleto: 'Maria' }).chave).toBeNull();
  });

  it('nome sozinho NUNCA gera chave — "Clinica Sorriso" existe em toda cidade', () => {
    const r = calcularChaveDedupe({ ...vazio, nomeCompleto: 'Clínica Sorriso' });
    expect(r.chave).toBeNull();
  });
});

describe('calcularChaveDedupe — estabilidade', () => {
  it('mesma entrada gera a mesma chave', () => {
    const dados = { ...vazio, telefoneNormalizado: '5519999998888' };
    expect(calcularChaveDedupe(dados).chave).toBe(calcularChaveDedupe(dados).chave);
  });

  it('ignora acento, caixa e pontuacao no nome', () => {
    const a = calcularChaveDedupe({
      ...vazio, nomeCompleto: 'Psicóloga Maria Silva', cidade: 'Campinas',
    });
    const b = calcularChaveDedupe({
      ...vazio, nomeCompleto: 'PSICOLOGA MARIA SILVA', cidade: 'CAMPINAS',
    });
    expect(a.chave).toBe(b.chave);
  });

  it('telefones diferentes geram chaves diferentes', () => {
    const a = calcularChaveDedupe({ ...vazio, telefoneNormalizado: '5519999998888' });
    const b = calcularChaveDedupe({ ...vazio, telefoneNormalizado: '5519999997777' });
    expect(a.chave).not.toBe(b.chave);
  });

  it('mesmo nome em cidades diferentes NAO colide', () => {
    const a = calcularChaveDedupe({ ...vazio, nomeCompleto: 'Clínica Vida', cidade: 'Campinas' });
    const b = calcularChaveDedupe({ ...vazio, nomeCompleto: 'Clínica Vida', cidade: 'Santos' });
    expect(a.chave).not.toBe(b.chave);
  });
});

describe('chaves secundarias — o caso que a chave primaria nao pega', () => {
  it('mesmo lead com e sem telefone compartilha a chave de nome+endereco', () => {
    const comTelefone = calcularChavesSecundarias({
      ...vazio,
      telefoneNormalizado: '5519999998888',
      nomeCompleto: 'Psicóloga Ana Costa',
      enderecoOriginal: 'Av. Norte-Sul, 456',
      cidade: 'Campinas',
    });
    const semTelefone = calcularChavesSecundarias({
      ...vazio,
      nomeCompleto: 'Psicóloga Ana Costa',
      enderecoOriginal: 'Av. Norte-Sul, 456',
      cidade: 'Campinas',
    });

    // As chaves PRIMARIAS sao diferentes...
    expect(comTelefone[0]!.criterio).toBe('TELEFONE');
    expect(semTelefone[0]!.criterio).toBe('NOME_ENDERECO');

    // ...mas ha interseccao nas secundarias, e e isso que detecta.
    const a = new Set(comTelefone.map((k) => k.chave));
    const intersecao = semTelefone.filter((k) => a.has(k.chave));
    expect(intersecao.length).toBeGreaterThan(0);
  });

  it('leads realmente diferentes nao tem interseccao', () => {
    const a = calcularChavesSecundarias({
      ...vazio, nomeCompleto: 'Maria Silva',
      enderecoOriginal: 'Rua A, 1', cidade: 'Campinas',
    });
    const b = calcularChavesSecundarias({
      ...vazio, nomeCompleto: 'Ana Costa',
      enderecoOriginal: 'Rua B, 2', cidade: 'Campinas',
    });
    const chavesA = new Set(a.map((k) => k.chave));
    expect(b.filter((k) => chavesA.has(k.chave)).length).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// PIPELINE COMPLETO
// -----------------------------------------------------------------------------
describe('normalizarLead — pipeline completo', () => {
  it('processa uma linha tipica do Google Maps', () => {
    const r = normalizarLead(
      {
        nome: 'Psicóloga Maria Silva',
        categoria: 'Psicólogo',
        telefone: '(19) 99999-1111',
        endereco: 'R. Ferreira Penteado, 123 - Cambuí, Campinas - SP, 13010-041',
        website: 'https://www.instagram.com/psicologamaria',
        avaliacao: '4,8',
        totalAvaliacoes: '87',
      },
      opcoes
    );

    expect(r.valido).toBe(true);
    expect(r.dados.nomeCompleto).toBe('Psicóloga Maria Silva');
    expect(r.dados.primeiroNome).toBe('Maria');
    expect(r.dados.telefoneNormalizado).toBe('5519999991111');
    expect(r.dados.bairro).toBe('Cambuí');
    expect(r.dados.cidade).toBe('Campinas');
    expect(r.dados.estado).toBe('SP');
    expect(r.dados.cep).toBe('13010-041');
    expect(r.dados.websiteStatus).toBe('REDE_SOCIAL');
    expect(r.semSiteProprio).toBe(true);
    expect(r.dados.instagramUrl).toContain('instagram.com');
    expect(r.dados.avaliacao).toBe(4.8);
    expect(r.dados.totalAvaliacoes).toBe(87);
  });

  it('reconhece site proprio', () => {
    const r = normalizarLead(
      { nome: 'Ana Costa', telefone: '(19) 99999-2222', website: 'psicologiaanacosta.com.br' },
      opcoes
    );
    expect(r.dados.websiteStatus).toBe('SITE_PROPRIO');
    expect(r.semSiteProprio).toBe(false);
  });

  it('website vazio conta como sem site', () => {
    const r = normalizarLead({ nome: 'João Pedro', telefone: '(19) 99999-3333' }, opcoes);
    expect(r.dados.websiteStatus).toBe('NAO_INFORMADO');
    expect(r.semSiteProprio).toBe(true);
  });

  it('linha sem nome e invalida', () => {
    const r = normalizarLead({ telefone: '(19) 99999-4444' }, opcoes);
    expect(r.valido).toBe(false);
    expect(r.erros[0]).toMatch(/sem nome/);
  });

  it('lead sem telefone continua valido, mas marcado', () => {
    const r = normalizarLead({ nome: 'Consultório X', cidade: 'Campinas' }, opcoes);
    expect(r.valido).toBe(true);
    expect(r.semTelefone).toBe(true);
  });

  it('exigirTelefone torna a linha invalida', () => {
    const r = normalizarLead(
      { nome: 'Consultório X', cidade: 'Campinas' },
      { ...opcoes, exigirTelefone: true }
    );
    expect(r.valido).toBe(false);
  });

  it('telefone sem DDD vira aviso, nao numero inventado', () => {
    const r = normalizarLead(
      { nome: 'Beatriz Lima', telefone: '99999-5555', cidade: 'Campinas' },
      opcoes
    );
    expect(r.dados.telefoneNormalizado).toBeNull();
    expect(r.avisos.some((a) => a.campo === 'telefone')).toBe(true);
  });

  it('nome de empresa nao gera primeiro nome e avisa', () => {
    const r = normalizarLead(
      { nome: 'Clínica Bem Viver', telefone: '(19) 3232-1010' },
      opcoes
    );
    expect(r.dados.primeiroNome).toBeNull();
    expect(r.dados.empresa).toBe('Clínica Bem Viver');
    expect(r.avisos.some((a) => a.campo === 'primeiroNome')).toBe(true);
  });

  it('bairro ausente gera aviso e fica NULL — nunca deduzido', () => {
    const r = normalizarLead(
      { nome: 'Maria', telefone: '(19) 99999-1111', endereco: 'Av. Paulista, 1000, São Paulo - SP' },
      opcoes
    );
    expect(r.dados.bairro).toBeNull();
    expect(r.avisos.some((a) => a.campo === 'bairro')).toBe(true);
  });

  it('coluna dedicada de bairro tem prioridade sobre o texto do endereco', () => {
    const r = normalizarLead(
      {
        nome: 'Maria', telefone: '(19) 99999-1111',
        endereco: 'R. X, 1 - Centro, Campinas - SP',
        bairro: 'Cambuí',
      },
      opcoes
    );
    expect(r.dados.bairro).toBe('Cambuí');
  });

  it('preserva os valores originais ao lado dos normalizados', () => {
    const r = normalizarLead(
      { nome: 'MARIA SILVA', telefone: '(19) 99999-1111' },
      opcoes
    );
    expect(r.originais.nome).toBe('MARIA SILVA');
    expect(r.dados.nomeCompleto).toBe('Maria Silva');
  });

  it('colunas totalmente ausentes nao quebram nada', () => {
    const r = normalizarLead({ nome: 'Maria', cidade: 'Campinas' }, opcoes);
    expect(r.valido).toBe(true);
    expect(r.dados.email).toBeNull();
    expect(r.dados.cep).toBeNull();
    expect(r.dados.avaliacao).toBeNull();
  });

  it('a lista de dominios sociais vem de fora — nao esta no codigo', () => {
    const semConfig = normalizarLead(
      { nome: 'Maria', telefone: '(19) 99999-1111', website: 'instagram.com/maria' },
      { dominiosSociais: [], ddiPadrao: '55' }
    );
    expect(semConfig.dados.websiteStatus).toBe('SITE_PROPRIO');

    const comConfig = normalizarLead(
      { nome: 'Maria', telefone: '(19) 99999-1111', website: 'instagram.com/maria' },
      opcoes
    );
    expect(comConfig.dados.websiteStatus).toBe('REDE_SOCIAL');
  });
});
