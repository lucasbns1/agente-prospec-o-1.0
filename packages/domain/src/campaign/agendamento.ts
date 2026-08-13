/**
 * Agendamento de envio (Fase H).
 *
 * Nada sai imediatamente. Toda mensagem recebe um `scheduledAt` que
 * respeita janela de horario, dias permitidos, intervalo entre
 * mensagens e limites por hora/dia.
 *
 * Funcao pura: recebe o instante atual e a configuracao, devolve a
 * data. Nao le relogio do sistema por conta propria — e isso que torna
 * o agendamento testavel de forma deterministica.
 *
 * SOBRE FUSO HORARIO: todos os calculos usam o horario LOCAL do
 * processo. O sistema roda na maquina do usuario, no fuso dele, e a
 * janela "08:00 as 20:00" e a janela local. Converter para UTC aqui so
 * criaria confusao.
 */

export interface JanelaEnvio {
  /** "HH:MM" */
  horarioInicio: string;
  /** "HH:MM" */
  horarioFim: string;
  /** 0=domingo ... 6=sabado */
  diasPermitidos: number[];
}

export interface LimitesEnvio {
  limiteDiario: number;
  limiteHorario: number;
  /** Quantos ja saíram hoje. */
  enviadosHoje: number;
  /** Quantos saíram na ultima hora. */
  enviadosNaHora: number;
}

export interface IntervaloEnvio {
  minSegundos: number;
  maxSegundos: number;
}

export type MotivoReagendamento =
  | 'FORA_DA_JANELA'
  | 'DIA_NAO_PERMITIDO'
  | 'LIMITE_DIARIO'
  | 'LIMITE_HORARIO'
  | null;

export interface ResultadoAgendamento {
  /** Quando a mensagem deve sair. */
  scheduledAt: Date;
  /** true quando o horario pedido nao servia e foi empurrado. */
  reagendado: boolean;
  motivo: MotivoReagendamento;
  /** Explicacao legivel para a tela. */
  detalhe: string;
}

/** Converte "HH:MM" em minutos desde a meia-noite. `null` se invalido. */
export function parseHorario(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number.parseInt(m[1]!, 10);
  const min = Number.parseInt(m[2]!, 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function minutosDoDia(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** true quando o instante cai dentro da janela permitida. */
export function dentroDaJanela(quando: Date, janela: JanelaEnvio): boolean {
  if (!janela.diasPermitidos.includes(quando.getDay())) return false;

  const inicio = parseHorario(janela.horarioInicio);
  const fim = parseHorario(janela.horarioFim);
  // Janela invalida nao pode liberar envio em horario qualquer.
  if (inicio === null || fim === null) return false;

  const agora = minutosDoDia(quando);
  return agora >= inicio && agora < fim;
}

/**
 * Empurra a data para o proximo instante dentro da janela.
 *
 * Procura no maximo 14 dias a frente. Se a configuracao nao permitir
 * nenhum dia (array vazio, por exemplo), devolve `null` em vez de
 * entrar em laco infinito.
 */
export function proximoHorarioValido(
  a_partir_de: Date,
  janela: JanelaEnvio
): Date | null {
  const inicio = parseHorario(janela.horarioInicio);
  const fim = parseHorario(janela.horarioFim);
  if (inicio === null || fim === null) return null;
  if (janela.diasPermitidos.length === 0) return null;
  if (inicio >= fim) return null;

  const candidato = new Date(a_partir_de.getTime());

  for (let dia = 0; dia < 14; dia++) {
    const alvo = new Date(candidato.getTime());
    alvo.setDate(alvo.getDate() + dia);

    if (!janela.diasPermitidos.includes(alvo.getDay())) continue;

    if (dia === 0) {
      const agora = minutosDoDia(alvo);
      // Ja passou da janela hoje: tenta amanha.
      if (agora >= fim) continue;
      // Ainda nao abriu: espera abrir.
      if (agora < inicio) {
        alvo.setHours(Math.floor(inicio / 60), inicio % 60, 0, 0);
        return alvo;
      }
      // Dentro da janela: pode ser agora.
      return alvo;
    }

    alvo.setHours(Math.floor(inicio / 60), inicio % 60, 0, 0);
    return alvo;
  }

  return null;
}

/**
 * Calcula quando uma mensagem deve sair.
 *
 * @param rng aleatoriedade injetavel, para os testes serem
 *            deterministicos. O intervalo entre mensagens NUNCA e fixo.
 */
export function calcularAgendamento(opcoes: {
  agora: Date;
  /** Quando a mensagem anterior desta campanha saiu (ou vai sair). */
  ultimoEnvio?: Date | null;
  intervalo: IntervaloEnvio;
  janela: JanelaEnvio;
  limites: LimitesEnvio;
  rng?: () => number;
}): ResultadoAgendamento | { bloqueado: true; motivo: MotivoReagendamento; detalhe: string } {
  const { agora, intervalo, janela, limites } = opcoes;
  const rng = opcoes.rng ?? Math.random;

  // --- Limite diario: nao adianta reagendar para hoje ---
  if (limites.enviadosHoje >= limites.limiteDiario) {
    const amanha = new Date(agora.getTime());
    amanha.setDate(amanha.getDate() + 1);
    amanha.setHours(0, 0, 0, 0);

    const proximo = proximoHorarioValido(amanha, janela);
    if (!proximo) {
      return {
        bloqueado: true,
        motivo: 'LIMITE_DIARIO',
        detalhe: `Limite diario de ${limites.limiteDiario} atingido e nenhuma janela valida adiante`,
      };
    }
    return {
      scheduledAt: proximo,
      reagendado: true,
      motivo: 'LIMITE_DIARIO',
      detalhe: `Limite diario de ${limites.limiteDiario} atingido — reagendado para o proximo dia util`,
    };
  }

  // --- Intervalo minimo desde o ultimo envio ---
  const espera = Math.floor(
    intervalo.minSegundos +
      rng() * (Math.max(0, intervalo.maxSegundos - intervalo.minSegundos) + 1)
  );

  let base = new Date(agora.getTime() + espera * 1000);

  if (opcoes.ultimoEnvio) {
    const minimoAposUltimo = new Date(
      opcoes.ultimoEnvio.getTime() + intervalo.minSegundos * 1000
    );
    if (minimoAposUltimo > base) base = minimoAposUltimo;
  }

  // --- Limite por hora ---
  if (limites.enviadosNaHora >= limites.limiteHorario) {
    const proximaHora = new Date(agora.getTime() + 3600_000);
    if (proximaHora > base) base = proximaHora;

    const dentro = proximoHorarioValido(base, janela);
    if (!dentro) {
      return {
        bloqueado: true,
        motivo: 'LIMITE_HORARIO',
        detalhe: `Limite de ${limites.limiteHorario}/hora atingido e nenhuma janela valida adiante`,
      };
    }
    return {
      scheduledAt: dentro,
      reagendado: true,
      motivo: 'LIMITE_HORARIO',
      detalhe: `Limite de ${limites.limiteHorario} por hora atingido — adiado uma hora`,
    };
  }

  // --- Janela de horario e dias ---
  if (dentroDaJanela(base, janela)) {
    return {
      scheduledAt: base,
      reagendado: false,
      motivo: null,
      detalhe: `Agendado para daqui a ${espera}s`,
    };
  }

  const ajustado = proximoHorarioValido(base, janela);
  if (!ajustado) {
    return {
      bloqueado: true,
      motivo: 'FORA_DA_JANELA',
      detalhe:
        `Nenhuma janela valida nos proximos 14 dias ` +
        `(${janela.horarioInicio}-${janela.horarioFim}, dias ${janela.diasPermitidos.join(',')})`,
    };
  }

  const foiDia = !janela.diasPermitidos.includes(base.getDay());
  return {
    scheduledAt: ajustado,
    reagendado: true,
    motivo: foiDia ? 'DIA_NAO_PERMITIDO' : 'FORA_DA_JANELA',
    detalhe: foiDia
      ? 'Dia nao permitido — reagendado para o proximo dia liberado'
      : `Fora da janela ${janela.horarioInicio}-${janela.horarioFim} — reagendado`,
  };
}

/**
 * Espalha o PRIMEIRO disparo de varios leads no tempo.
 *
 * Enviar a MSG 1 para 76 leads no mesmo segundo e o padrao de disparo em
 * massa mais obvio que existe — e o que mais chama a atencao dos
 * sistemas antispam. Cada lead recebe um deslocamento crescente e
 * aleatorio dentro do intervalo configurado.
 */
export function distribuirNoTempo(
  quantidade: number,
  inicio: Date,
  intervalo: IntervaloEnvio,
  rng: () => number = Math.random
): Date[] {
  const datas: Date[] = [];
  let acumulado = 0;

  for (let i = 0; i < quantidade; i++) {
    if (i > 0) {
      const gap =
        intervalo.minSegundos +
        Math.floor(rng() * (Math.max(0, intervalo.maxSegundos - intervalo.minSegundos) + 1));
      acumulado += gap;
    }
    datas.push(new Date(inicio.getTime() + acumulado * 1000));
  }

  return datas;
}
