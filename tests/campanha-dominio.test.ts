/**
 * Testes das regras puras de campanha: qualificacao, template e
 * agendamento.
 *
 * Nada aqui toca banco. Se estes testes passam, a logica esta certa —
 * independentemente de como a API a chama.
 */
import { describe, expect, it } from 'vitest';
import {
  qualificarLead,
  podeEntrarEmCampanha,
  type LeadParaQualificar,
} from '../packages/domain/src/campaign/qualificacao.js';
import {
  renderizarMensagem,
  extrairVariaveis,
  type ContextoLead,
} from '../packages/domain/src/campaign/template.js';
import {
  calcularAgendamento,
  dentroDaJanela,
  proximoHorarioValido,
  parseHorario,
  distribuirNoTempo,
} from '../packages/domain/src/campaign/agendamento.js';

// =============================================================================
// QUALIFICACAO
// =============================================================================
const LEAD_BASE: LeadParaQualificar = {
  id: 'l1',
  nomeCompleto: 'Clínica Odonto Sorriso',
  primeiroNome: null,
  empresa: 'Clínica Odonto Sorriso',
  telefoneNormalizado: '5519999991111',
  websiteStatus: 'NAO_INFORMADO',
  instagramUrl: null,
  cidade: 'Campinas',
  estado: 'SP',
  categoria: 'Dentista',
  avaliacao: 4.8,
  totalAvaliacoes: 137,
  status: 'PRONTO',
  optOut: false,
  tags: [],
  jaContatado: false,
};

describe('qualificacao — bloqueios inviolaveis', () => {
  it('opt-out bloqueia, mesmo atendendo a todos os criterios', () => {
    const r = qualificarLead({ ...LEAD_BASE, optOut: true }, { exigirSemSite: true });
    expect(r.qualificacao).toBe('BLOQUEADO');
    expect(r.motivo).toMatch(/opt-out/i);
    expect(podeEntrarEmCampanha(r.qualificacao)).toBe(false);
  });

  it('sem telefone bloqueia — nao ha como enviar', () => {
    const r = qualificarLead({ ...LEAD_BASE, telefoneNormalizado: null });
    expect(r.qualificacao).toBe('BLOQUEADO');
    expect(r.motivo).toMatch(/telefone/i);
  });

  it.each(['OPT_OUT', 'AGUARDANDO_INTERVENCAO', 'PAUSADO'])(
    'status %s bloqueia',
    (status) => {
      const r = qualificarLead({ ...LEAD_BASE, status });
      expect(r.qualificacao).toBe('BLOQUEADO');
    }
  );

  it('bloqueio vem ANTES dos criterios — nao depende de configuracao', () => {
    const r = qualificarLead(
      { ...LEAD_BASE, optOut: true },
      { exigirComSite: true, avaliacaoMinima: 5 }
    );
    expect(r.qualificacao).toBe('BLOQUEADO');
    expect(r.motivo).toMatch(/opt-out/i);
  });
});

describe('qualificacao — REVISAR', () => {
  it('lead sem nome e sem empresa precisa de olhar humano', () => {
    const r = qualificarLead({
      ...LEAD_BASE, nomeCompleto: null, empresa: null,
    });
    expect(r.qualificacao).toBe('REVISAR');
    expect(r.motivo).toMatch(/nome/i);
  });
});

describe('qualificacao — criterios da campanha', () => {
  it('qualifica quando atende a tudo', () => {
    const r = qualificarLead(LEAD_BASE, { exigirSemSite: true, avaliacaoMinima: 4 });
    expect(r.qualificacao).toBe('QUALIFICADO');
    expect(r.motivo).toMatch(/sem site/);
    expect(r.falhas).toEqual([]);
    expect(podeEntrarEmCampanha(r.qualificacao)).toBe(true);
  });

  it('lead com site nao passa no filtro "sem site"', () => {
    const r = qualificarLead(
      { ...LEAD_BASE, websiteStatus: 'SITE_PROPRIO' },
      { exigirSemSite: true }
    );
    expect(r.qualificacao).toBe('NAO_QUALIFICADO');
    expect(r.motivo).toMatch(/ja possui site/i);
  });

  it('rede social conta como SEM site', () => {
    const r = qualificarLead(
      { ...LEAD_BASE, websiteStatus: 'REDE_SOCIAL' },
      { exigirSemSite: true }
    );
    expect(r.qualificacao).toBe('QUALIFICADO');
  });

  it('filtra por Instagram nos dois sentidos', () => {
    expect(
      qualificarLead({ ...LEAD_BASE, instagramUrl: 'x' }, { exigirSemInstagram: true })
        .qualificacao
    ).toBe('NAO_QUALIFICADO');
    expect(
      qualificarLead(LEAD_BASE, { exigirSemInstagram: true }).qualificacao
    ).toBe('QUALIFICADO');
    expect(
      qualificarLead(LEAD_BASE, { exigirComInstagram: true }).qualificacao
    ).toBe('NAO_QUALIFICADO');
  });

  it('filtra por avaliacao minima', () => {
    expect(qualificarLead(LEAD_BASE, { avaliacaoMinima: 4.5 }).qualificacao)
      .toBe('QUALIFICADO');
    expect(qualificarLead(LEAD_BASE, { avaliacaoMinima: 4.9 }).qualificacao)
      .toBe('NAO_QUALIFICADO');
  });

  it('lead sem avaliacao nao passa em filtro de avaliacao minima', () => {
    const r = qualificarLead({ ...LEAD_BASE, avaliacao: null }, { avaliacaoMinima: 4 });
    expect(r.qualificacao).toBe('NAO_QUALIFICADO');
    expect(r.motivo).toMatch(/sem avaliacao/i);
  });

  it('filtra por total de avaliacoes', () => {
    expect(qualificarLead(LEAD_BASE, { totalAvaliacoesMinimo: 100 }).qualificacao)
      .toBe('QUALIFICADO');
    expect(qualificarLead(LEAD_BASE, { totalAvaliacoesMinimo: 200 }).qualificacao)
      .toBe('NAO_QUALIFICADO');
  });

  it('filtra por cidade ignorando acento e caixa', () => {
    expect(qualificarLead(LEAD_BASE, { cidades: ['CAMPINAS'] }).qualificacao)
      .toBe('QUALIFICADO');
    expect(
      qualificarLead({ ...LEAD_BASE, cidade: 'São Paulo' }, { cidades: ['sao paulo'] })
        .qualificacao
    ).toBe('QUALIFICADO');
    expect(qualificarLead(LEAD_BASE, { cidades: ['Santos'] }).qualificacao)
      .toBe('NAO_QUALIFICADO');
  });

  it('filtra por estado e categoria', () => {
    expect(qualificarLead(LEAD_BASE, { estados: ['sp'] }).qualificacao).toBe('QUALIFICADO');
    expect(qualificarLead(LEAD_BASE, { estados: ['RJ'] }).qualificacao).toBe('NAO_QUALIFICADO');
    expect(qualificarLead(LEAD_BASE, { categorias: ['dentista'] }).qualificacao)
      .toBe('QUALIFICADO');
  });

  it('filtra por tags', () => {
    const comTag = { ...LEAD_BASE, tags: ['premium', 'centro'] };
    expect(qualificarLead(comTag, { tags: ['premium'] }).qualificacao).toBe('QUALIFICADO');
    expect(qualificarLead(LEAD_BASE, { tags: ['premium'] }).qualificacao)
      .toBe('NAO_QUALIFICADO');
  });

  it('filtra quem ja foi contatado', () => {
    const r = qualificarLead(
      { ...LEAD_BASE, jaContatado: true },
      { apenasNuncaContatados: true }
    );
    expect(r.qualificacao).toBe('NAO_QUALIFICADO');
    expect(r.motivo).toMatch(/ja foi contatado/i);
  });

  it('acumula TODAS as falhas, nao so a primeira', () => {
    const r = qualificarLead(
      { ...LEAD_BASE, websiteStatus: 'SITE_PROPRIO', avaliacao: 2 },
      { exigirSemSite: true, avaliacaoMinima: 4, cidades: ['Santos'] }
    );
    expect(r.falhas.length).toBe(3);
  });

  it('sem criterios, qualquer lead contatavel e QUALIFICADO', () => {
    expect(qualificarLead(LEAD_BASE).qualificacao).toBe('QUALIFICADO');
  });
});

// =============================================================================
// TEMPLATE
// =============================================================================
const CTX: ContextoLead = {
  nome: 'Maria Silva',
  primeiro_nome: 'Maria',
  empresa: 'Clínica Odonto Sorriso',
  cidade: 'Campinas',
  bairro: 'Cambuí',
  estado: 'SP',
  categoria: 'Dentista',
  telefone: '5519999991111',
  avaliacao: 4.8,
  totalAvaliacoes: 137,
  site_preview_url: null,
};

describe('extrairVariaveis', () => {
  it('encontra as variaveis do template', () => {
    expect(extrairVariaveis('Olá {{nome}}, vi a {{empresa}}!').sort())
      .toEqual(['empresa', 'nome']);
  });
  it('tolera espacos dentro das chaves', () => {
    expect(extrairVariaveis('{{ nome }}')).toEqual(['nome']);
  });
  it('nao duplica', () => {
    expect(extrairVariaveis('{{nome}} {{nome}}')).toEqual(['nome']);
  });
});

describe('renderizarMensagem — personalizacao', () => {
  it('renderiza com os dados do lead', () => {
    const r = renderizarMensagem(
      'Olá, {{nome}}! Vi a {{empresa}} no Google, em {{cidade}}, e percebi que vocês ainda não possuem um site próprio.',
      CTX
    );
    expect(r.ok).toBe(true);
    expect(r.texto).toBe(
      'Olá, Maria! Vi a Clínica Odonto Sorriso no Google, em Campinas, e percebi que vocês ainda não possuem um site próprio.'
    );
    expect(r.variaveisUsadas['empresa']).toBe('Clínica Odonto Sorriso');
  });

  it('cada lead recebe SUA mensagem — nunca dados de outro', () => {
    const template = 'Vi a {{empresa}} em {{cidade}}.';
    const a = renderizarMensagem(template, CTX);
    const b = renderizarMensagem(template, {
      ...CTX, empresa: 'Studio Bella', cidade: 'Santos',
    });
    expect(a.texto).toContain('Clínica Odonto Sorriso');
    expect(a.texto).toContain('Campinas');
    expect(b.texto).toContain('Studio Bella');
    expect(b.texto).toContain('Santos');
    expect(a.texto).not.toContain('Santos');
    expect(b.texto).not.toContain('Campinas');
  });

  it('usa o primeiro nome em {{nome}} — soa melhor', () => {
    const r = renderizarMensagem('Olá {{nome}}', CTX);
    expect(r.texto).toBe('Olá Maria');
  });

  it('renderiza avaliacao e total', () => {
    const r = renderizarMensagem(
      'Vi que a {{empresa}} tem {{avaliacao}} estrelas com {{totalAvaliacoes}} avaliações.',
      CTX
    );
    expect(r.texto).toContain('4.8');
    expect(r.texto).toContain('137');
  });
});

describe('renderizarMensagem — NUNCA inventa nome', () => {
  const semNome: ContextoLead = { ...CTX, nome: null, primeiro_nome: null };

  it('"Olá, {{nome}}!" vira "Olá!" quando nao ha nome', () => {
    const r = renderizarMensagem('Olá, {{nome}}! Vi a {{empresa}}.', semNome);
    expect(r.ok).toBe(true);
    expect(r.texto).toBe('Olá! Vi a Clínica Odonto Sorriso.');
    expect(r.texto).not.toMatch(/\{\{/);
    expect(r.fallbacksAplicados).toContain('saudacao sem nome');
  });

  it.each([
    ['Oi, {{nome}}! Tudo bem?', 'Oi! Tudo bem?'],
    ['Bom dia, {{primeiro_nome}}. Vi a {{empresa}}.', 'Bom dia. Vi a Clínica Odonto Sorriso.'],
    ['Boa tarde, {{nome}}!', 'Boa tarde!'],
  ])('%s => %s', (template, esperado) => {
    expect(renderizarMensagem(template, semNome).texto).toBe(esperado);
  });

  it('nunca deixa um placeholder visivel na mensagem', () => {
    const r = renderizarMensagem('Olá, {{nome}}! Vi a {{empresa}}.', semNome);
    expect(r.texto).not.toMatch(/\[Nome\]|\{\{|undefined|null/);
  });

  // O caso que apareceu na previa real da Fase 4: lead de empresa, onde
  // `nome` carrega a razao social e `primeiro_nome` e null. Antes da
  // correcao a mensagem saia como "Olá, Clínica Bem Viver! Vi a Clínica
  // Bem Viver..." — nome de empresa usado como se fosse gente, repetido
  // duas vezes na mesma frase.
  const soEmpresa: ContextoLead = {
    ...CTX,
    nome: 'Clínica Bem Viver',
    primeiro_nome: null,
    empresa: 'Clínica Bem Viver',
  };

  it('nao usa a razao social como se fosse nome de pessoa', () => {
    const r = renderizarMensagem(
      'Olá, {{nome}}! Vi a {{empresa}} no Google, em {{cidade}}.',
      soEmpresa
    );
    expect(r.ok).toBe(true);
    expect(r.texto).toBe('Olá! Vi a Clínica Bem Viver no Google, em Campinas.');
    expect(r.fallbacksAplicados).toContain('saudacao sem nome');
    expect(r.variaveisUsadas['nome']).toBeUndefined();
  });

  it('nao repete o nome da empresa duas vezes na mesma frase', () => {
    const r = renderizarMensagem('Olá, {{nome}}! Vi a {{empresa}}.', soEmpresa);
    const ocorrencias = (r.texto ?? '').split('Clínica Bem Viver').length - 1;
    expect(ocorrencias).toBe(1);
  });

  // Se o criterio de `temNome` divergir do de `{{nome}}`, o fallback nao
  // dispara, a variavel fica sem valor e TODO lead de empresa vira
  // bloqueio — o inverso do problema, igualmente grave.
  it('lead so-empresa continua enviavel — nao vira bloqueio', () => {
    const r = renderizarMensagem('Olá, {{nome}}! Vi a {{empresa}}.', soEmpresa);
    expect(r.ok).toBe(true);
    expect(r.motivoBloqueio).toBeNull();
    expect(r.faltando).toEqual([]);
  });

  it('remove o trecho de cidade quando ela nao existe', () => {
    const r = renderizarMensagem(
      'Vi a {{empresa}}, em {{cidade}}, no Google.',
      { ...CTX, cidade: null }
    );
    expect(r.ok).toBe(true);
    expect(r.texto).toBe('Vi a Clínica Odonto Sorriso no Google.');
  });
});

describe('renderizarMensagem — bloqueios', () => {
  it('variavel obrigatoria ausente bloqueia', () => {
    const r = renderizarMensagem('Vi a {{empresa}}.', { ...CTX, empresa: null, nome: null });
    expect(r.ok).toBe(false);
    expect(r.texto).toBeNull();
    expect(r.motivoBloqueio).toMatch(/obrigatoria/i);
    expect(r.faltando).toContain('empresa');
  });

  it('variavel desconhecida bloqueia', () => {
    const r = renderizarMensagem('Olá {{inventada}}', CTX);
    expect(r.ok).toBe(false);
    expect(r.desconhecidas).toContain('inventada');
  });

  it('variavel opcional sem valor e sem fallback bloqueia', () => {
    const r = renderizarMensagem('Seu bairro é {{bairro}}.', { ...CTX, bairro: null });
    expect(r.ok).toBe(false);
    expect(r.faltando).toContain('bairro');
  });

  it('template vazio bloqueia', () => {
    expect(renderizarMensagem('', CTX).ok).toBe(false);
    expect(renderizarMensagem('   ', CTX).ok).toBe(false);
  });

  it('mensagem longa demais bloqueia', () => {
    const r = renderizarMensagem('x'.repeat(5000), CTX, { tamanhoMaximo: 4000 });
    expect(r.ok).toBe(false);
    expect(r.motivoBloqueio).toMatch(/caracteres/);
  });
});

// =============================================================================
// AGENDAMENTO
// =============================================================================
const JANELA = {
  horarioInicio: '08:00',
  horarioFim: '20:00',
  diasPermitidos: [1, 2, 3, 4, 5],
};
const LIMITES = {
  limiteDiario: 50, limiteHorario: 10, enviadosHoje: 0, enviadosNaHora: 0,
};
const INTERVALO = { minSegundos: 180, maxSegundos: 240 };

/** 2026-01-12 e uma segunda-feira. */
const SEGUNDA_10H = new Date(2026, 0, 12, 10, 0, 0);
const SEGUNDA_22H = new Date(2026, 0, 12, 22, 0, 0);
const SEGUNDA_6H = new Date(2026, 0, 12, 6, 0, 0);
const SABADO_10H = new Date(2026, 0, 17, 10, 0, 0);

describe('parseHorario', () => {
  it('converte para minutos', () => {
    expect(parseHorario('08:00')).toBe(480);
    expect(parseHorario('20:30')).toBe(1230);
    expect(parseHorario('00:00')).toBe(0);
  });
  it('rejeita invalidos', () => {
    expect(parseHorario('25:00')).toBeNull();
    expect(parseHorario('8h')).toBeNull();
    expect(parseHorario('')).toBeNull();
  });
});

describe('dentroDaJanela', () => {
  it('segunda 10h esta dentro', () => {
    expect(dentroDaJanela(SEGUNDA_10H, JANELA)).toBe(true);
  });
  it('segunda 22h esta fora', () => {
    expect(dentroDaJanela(SEGUNDA_22H, JANELA)).toBe(false);
  });
  it('segunda 6h esta fora', () => {
    expect(dentroDaJanela(SEGUNDA_6H, JANELA)).toBe(false);
  });
  it('sabado esta fora (dia nao permitido)', () => {
    expect(dentroDaJanela(SABADO_10H, JANELA)).toBe(false);
  });
  it('janela invalida nao libera envio', () => {
    expect(dentroDaJanela(SEGUNDA_10H, { ...JANELA, horarioInicio: 'xx' })).toBe(false);
  });
});

describe('proximoHorarioValido', () => {
  it('antes de abrir, espera abrir no mesmo dia', () => {
    const r = proximoHorarioValido(SEGUNDA_6H, JANELA)!;
    expect(r.getDate()).toBe(12);
    expect(r.getHours()).toBe(8);
  });

  it('depois de fechar, vai para o dia seguinte', () => {
    const r = proximoHorarioValido(SEGUNDA_22H, JANELA)!;
    expect(r.getDate()).toBe(13);
    expect(r.getHours()).toBe(8);
  });

  it('sabado pula para segunda', () => {
    const r = proximoHorarioValido(SABADO_10H, JANELA)!;
    expect(r.getDay()).toBe(1);
    expect(r.getDate()).toBe(19);
  });

  it('devolve null quando nenhum dia e permitido', () => {
    expect(proximoHorarioValido(SEGUNDA_10H, { ...JANELA, diasPermitidos: [] })).toBeNull();
  });

  it('devolve null com janela invertida', () => {
    expect(
      proximoHorarioValido(SEGUNDA_10H, { ...JANELA, horarioInicio: '20:00', horarioFim: '08:00' })
    ).toBeNull();
  });
});

describe('calcularAgendamento', () => {
  it('dentro da janela, agenda para daqui a alguns minutos', () => {
    const r = calcularAgendamento({
      agora: SEGUNDA_10H, intervalo: INTERVALO, janela: JANELA,
      limites: LIMITES, rng: () => 0,
    });
    expect('bloqueado' in r).toBe(false);
    const ok = r as { scheduledAt: Date; reagendado: boolean };
    expect(ok.reagendado).toBe(false);
    expect(ok.scheduledAt.getTime()).toBe(SEGUNDA_10H.getTime() + 180_000);
  });

  it('o intervalo e ALEATORIO, nunca fixo', () => {
    const valores = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const r = calcularAgendamento({
        agora: SEGUNDA_10H, intervalo: INTERVALO, janela: JANELA, limites: LIMITES,
      }) as { scheduledAt: Date };
      valores.add(r.scheduledAt.getTime());
    }
    expect(valores.size).toBeGreaterThan(10);
  });

  it('fora da janela, reagenda', () => {
    const r = calcularAgendamento({
      agora: SEGUNDA_22H, intervalo: INTERVALO, janela: JANELA, limites: LIMITES,
    }) as { scheduledAt: Date; reagendado: boolean; motivo: string };
    expect(r.reagendado).toBe(true);
    expect(r.motivo).toBe('FORA_DA_JANELA');
    expect(r.scheduledAt.getHours()).toBe(8);
  });

  it('sabado reagenda para segunda', () => {
    const r = calcularAgendamento({
      agora: SABADO_10H, intervalo: INTERVALO, janela: JANELA, limites: LIMITES,
    }) as { scheduledAt: Date; motivo: string };
    expect(r.motivo).toBe('DIA_NAO_PERMITIDO');
    expect(r.scheduledAt.getDay()).toBe(1);
  });

  it('limite diario atingido reagenda para o proximo dia', () => {
    const r = calcularAgendamento({
      agora: SEGUNDA_10H, intervalo: INTERVALO, janela: JANELA,
      limites: { ...LIMITES, enviadosHoje: 50 },
    }) as { scheduledAt: Date; motivo: string };
    expect(r.motivo).toBe('LIMITE_DIARIO');
    expect(r.scheduledAt.getDate()).toBe(13);
  });

  it('limite horario atingido adia uma hora', () => {
    const r = calcularAgendamento({
      agora: SEGUNDA_10H, intervalo: INTERVALO, janela: JANELA,
      limites: { ...LIMITES, enviadosNaHora: 10 },
    }) as { scheduledAt: Date; motivo: string };
    expect(r.motivo).toBe('LIMITE_HORARIO');
    expect(r.scheduledAt.getHours()).toBeGreaterThanOrEqual(11);
  });

  it('respeita o intervalo minimo desde o ultimo envio', () => {
    const ultimo = new Date(SEGUNDA_10H.getTime() + 120_000);
    const r = calcularAgendamento({
      agora: SEGUNDA_10H, ultimoEnvio: ultimo, intervalo: INTERVALO,
      janela: JANELA, limites: LIMITES, rng: () => 0,
    }) as { scheduledAt: Date };
    expect(r.scheduledAt.getTime()).toBeGreaterThanOrEqual(
      ultimo.getTime() + INTERVALO.minSegundos * 1000
    );
  });

  it('bloqueia quando nenhuma janela e possivel', () => {
    const r = calcularAgendamento({
      agora: SEGUNDA_22H, intervalo: INTERVALO,
      janela: { ...JANELA, diasPermitidos: [] }, limites: LIMITES,
    });
    expect('bloqueado' in r).toBe(true);
  });
});

describe('distribuirNoTempo', () => {
  it('espalha o primeiro disparo entre leads', () => {
    const datas = distribuirNoTempo(5, SEGUNDA_10H, { minSegundos: 60, maxSegundos: 180 }, () => 0);
    expect(datas).toHaveLength(5);
    expect(datas[0]!.getTime()).toBe(SEGUNDA_10H.getTime());
    expect(datas[1]!.getTime()).toBe(SEGUNDA_10H.getTime() + 60_000);
    expect(datas[4]!.getTime()).toBe(SEGUNDA_10H.getTime() + 240_000);
  });

  it('NUNCA dispara tudo no mesmo instante', () => {
    const datas = distribuirNoTempo(76, SEGUNDA_10H, { minSegundos: 60, maxSegundos: 180 });
    const distintos = new Set(datas.map((d) => d.getTime()));
    expect(distintos.size).toBe(76);
    // O ultimo tem que estar bem depois do primeiro.
    expect(datas[75]!.getTime() - datas[0]!.getTime()).toBeGreaterThan(60 * 75 * 1000 * 0.9);
  });
});
