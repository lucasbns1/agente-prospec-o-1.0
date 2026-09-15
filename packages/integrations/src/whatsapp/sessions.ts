/**
 * Slots de sessao do WhatsApp — permite ter dois numeros conectados
 * alternadamente sem escanear o QR Code toda vez que se troca.
 *
 * POR QUE "SLOT" E NAO "NUMERO":
 * O numero nao e uma entrada do sistema. Quem define o numero da sessao e o
 * telefone que escaneia o QR Code — o numero so aparece DEPOIS, vindo do
 * proprio WhatsApp. Entao o que o usuario escolhe na tela nao e um numero, e
 * sim qual conjunto de credenciais usar. Cada slot tem a sua pasta:
 *
 *   data/whatsapp/slot-1/   <- credenciais do numero 1
 *   data/whatsapp/slot-2/   <- credenciais do numero 2
 *   data/whatsapp/slot-ativo.json
 *
 * Como as credenciais de cada slot ficam guardadas, voltar para um numero ja
 * autenticado reconecta direto, sem QR. E isso que torna a troca util.
 *
 * O `numeroEsperado` de cada slot serve para CONFERIR, nunca para conectar:
 * depois que a sessao sobe, comparamos o numero que realmente autenticou com
 * o que o slot esperava. Escanear o slot 2 com o telefone errado tem que
 * virar um aviso na tela — e nao uma campanha inteira disparada pelo chip
 * errado.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SLOTS_VALIDOS = [1, 2] as const;
export type SlotId = (typeof SLOTS_VALIDOS)[number];

export interface SlotConfigurado {
  id: SlotId;
  rotulo: string;
  /** E.164 sem "+", ex.: "5511968662120". Vazio quando nao configurado. */
  numeroEsperado: string;
}

export interface SlotEstado extends SlotConfigurado {
  caminhoSessao: string;
  /** Ja tem credenciais no disco: reconecta sem pedir QR. */
  autenticado: boolean;
  ativo: boolean;
}

const ARQUIVO_SLOT_ATIVO = 'slot-ativo.json';

export function ehSlotValido(valor: unknown): valor is SlotId {
  const numero = typeof valor === 'string' ? Number(valor) : valor;
  return SLOTS_VALIDOS.includes(numero as SlotId);
}

/** Normaliza para E.164 sem "+", que e o formato usado pelo adapter. */
export function normalizarNumero(valor: string | undefined): string {
  return (valor ?? '').replace(/\D/g, '');
}

export function caminhoDoSlot(base: string, id: SlotId): string {
  return join(base, `slot-${id}`);
}

/**
 * Le a configuracao dos slots do ambiente.
 *
 * Um slot sem numero configurado continua utilizavel — so nao da para
 * conferir se o QR foi escaneado com o telefone certo.
 */
export function lerSlotsDoAmbiente(
  env: NodeJS.ProcessEnv = process.env
): SlotConfigurado[] {
  return SLOTS_VALIDOS.map((id) => ({
    id,
    rotulo: env[`WHATSAPP_SLOT_${id}_LABEL`]?.trim() || `Número ${id}`,
    numeroEsperado: normalizarNumero(env[`WHATSAPP_SLOT_${id}_NUMERO`]),
  }));
}

/**
 * Um slot conta como autenticado quando a pasta tem credenciais.
 *
 * Tanto o Baileys (`creds.json`) quanto o whatsapp-web.js (`session.json` /
 * pasta do Chrome) gravam dentro da pasta do slot; testamos os nomes
 * conhecidos e, por ultimo, a simples existencia da pasta com conteudo.
 */
export function slotAutenticado(caminhoSessao: string): boolean {
  if (!existsSync(caminhoSessao)) return false;
  return (
    existsSync(join(caminhoSessao, 'creds.json')) ||
    existsSync(join(caminhoSessao, 'session.json')) ||
    existsSync(join(caminhoSessao, 'Default'))
  );
}

export async function lerSlotAtivo(base: string): Promise<SlotId> {
  try {
    const bruto = await readFile(join(base, ARQUIVO_SLOT_ATIVO), 'utf8');
    const { slot } = JSON.parse(bruto) as { slot?: unknown };
    return ehSlotValido(slot) ? (Number(slot) as SlotId) : 1;
  } catch {
    // Sem arquivo (primeira execucao) ou JSON corrompido: cai no slot 1.
    return 1;
  }
}

/**
 * Grava qual slot esta em uso. E o que faz o worker voltar no MESMO numero
 * depois de um restart, em vez de sempre cair no slot 1.
 */
export async function gravarSlotAtivo(base: string, id: SlotId): Promise<void> {
  await mkdir(base, { recursive: true });
  await writeFile(
    join(base, ARQUIVO_SLOT_ATIVO),
    `${JSON.stringify({ slot: id, em: new Date().toISOString() }, null, 2)}\n`,
    'utf8'
  );
}

/** Apaga as credenciais de um slot. O proximo connect daquele slot pede QR. */
export async function apagarSessaoDoSlot(base: string, id: SlotId): Promise<void> {
  await rm(caminhoDoSlot(base, id), { recursive: true, force: true });
}

export async function listarSlots(
  base: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<SlotEstado[]> {
  const ativo = await lerSlotAtivo(base);
  return lerSlotsDoAmbiente(env).map((slot) => {
    const caminhoSessao = caminhoDoSlot(base, slot.id);
    return {
      ...slot,
      caminhoSessao,
      autenticado: slotAutenticado(caminhoSessao),
      ativo: slot.id === ativo,
    };
  });
}

export type ConferenciaNumero =
  | { ok: true; motivo: 'confere' | 'sem-numero-esperado' }
  | { ok: false; motivo: 'divergente'; esperado: string; conectado: string };

/**
 * Confere se o numero que autenticou e o que o slot esperava.
 *
 * Sem numero esperado configurado nao ha o que conferir — devolve ok, mas
 * com o motivo explicito, para a tela poder dizer que nao houve conferencia
 * em vez de dar a entender que passou na validacao.
 */
export function conferirNumero(
  numeroConectado: string | undefined,
  numeroEsperado: string
): ConferenciaNumero {
  const esperado = normalizarNumero(numeroEsperado);
  const conectado = normalizarNumero(numeroConectado);
  if (!esperado) return { ok: true, motivo: 'sem-numero-esperado' };
  if (!conectado) return { ok: true, motivo: 'sem-numero-esperado' };
  return esperado === conectado
    ? { ok: true, motivo: 'confere' }
    : { ok: false, motivo: 'divergente', esperado, conectado };
}
