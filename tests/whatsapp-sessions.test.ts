/**
 * Testes dos slots de numero.
 *
 * O que estes testes protegem: que trocar de numero nao embarale as
 * credenciais dos dois, que o slot escolhido sobrevive a um restart, e que
 * escanear o QR com o telefone errado seja detectado em vez de passar batido.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  caminhoDoSlot,
  conferirNumero,
  ehSlotValido,
  gravarSlotAtivo,
  lerSlotAtivo,
  lerSlotsDoAmbiente,
  listarSlots,
  apagarSessaoDoSlot,
  normalizarNumero,
  slotAutenticado,
} from '../packages/integrations/src/whatsapp/sessions.js';

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'wa-slots-'));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** Simula um slot ja autenticado, gravando credenciais na pasta dele. */
async function autenticar(slot: 1 | 2): Promise<void> {
  const caminho = caminhoDoSlot(base, slot);
  await mkdir(caminho, { recursive: true });
  await writeFile(join(caminho, 'creds.json'), '{}', 'utf8');
}

describe('validacao de slot', () => {
  it('aceita 1 e 2, como numero ou string', () => {
    expect(ehSlotValido(1)).toBe(true);
    expect(ehSlotValido('2')).toBe(true);
  });

  it('recusa qualquer outra coisa', () => {
    expect(ehSlotValido(3)).toBe(false);
    expect(ehSlotValido('0')).toBe(false);
    expect(ehSlotValido('abc')).toBe(false);
    expect(ehSlotValido(undefined)).toBe(false);
  });
});

describe('pastas de sessao', () => {
  it('cada slot tem a propria pasta', () => {
    expect(caminhoDoSlot(base, 1)).not.toBe(caminhoDoSlot(base, 2));
  });

  it('autenticar um slot nao autentica o outro', async () => {
    await autenticar(1);
    expect(slotAutenticado(caminhoDoSlot(base, 1))).toBe(true);
    expect(slotAutenticado(caminhoDoSlot(base, 2))).toBe(false);
  });

  it('apagar um slot preserva as credenciais do outro', async () => {
    await autenticar(1);
    await autenticar(2);
    await apagarSessaoDoSlot(base, 2);
    expect(slotAutenticado(caminhoDoSlot(base, 1))).toBe(true);
    expect(slotAutenticado(caminhoDoSlot(base, 2))).toBe(false);
  });
});

describe('slot ativo', () => {
  it('sem arquivo, comeca no slot 1', async () => {
    expect(await lerSlotAtivo(base)).toBe(1);
  });

  it('sobrevive a um restart — e o que faz voltar no mesmo numero', async () => {
    await gravarSlotAtivo(base, 2);
    expect(await lerSlotAtivo(base)).toBe(2);
  });

  it('arquivo corrompido nao derruba o boot', async () => {
    await mkdir(base, { recursive: true });
    await writeFile(join(base, 'slot-ativo.json'), 'nao e json', 'utf8');
    expect(await lerSlotAtivo(base)).toBe(1);
  });

  it('valor fora da faixa cai no slot 1 em vez de propagar lixo', async () => {
    await writeFile(join(base, 'slot-ativo.json'), '{"slot":9}', 'utf8');
    expect(await lerSlotAtivo(base)).toBe(1);
  });
});

describe('leitura do ambiente', () => {
  it('usa rotulo padrao quando nao configurado', () => {
    const slots = lerSlotsDoAmbiente({});
    expect(slots.map((s) => s.rotulo)).toEqual(['Número 1', 'Número 2']);
    expect(slots.every((s) => s.numeroEsperado === '')).toBe(true);
  });

  it('normaliza o numero para E.164 sem pontuacao', () => {
    const slots = lerSlotsDoAmbiente({
      WHATSAPP_SLOT_1_NUMERO: '+55 (11) 96866-2120',
      WHATSAPP_SLOT_2_NUMERO: '5511997629357',
    });
    expect(slots[0]!.numeroEsperado).toBe('5511968662120');
    expect(slots[1]!.numeroEsperado).toBe('5511997629357');
  });

  it('normalizarNumero tolera vazio', () => {
    expect(normalizarNumero(undefined)).toBe('');
  });
});

describe('listarSlots', () => {
  it('marca ativo e autenticado de cada um', async () => {
    await autenticar(2);
    await gravarSlotAtivo(base, 2);

    const slots = await listarSlots(base, {
      WHATSAPP_SLOT_1_NUMERO: '5511968662120',
      WHATSAPP_SLOT_2_NUMERO: '5511997629357',
    });

    expect(slots[0]).toMatchObject({ id: 1, ativo: false, autenticado: false });
    expect(slots[1]).toMatchObject({ id: 2, ativo: true, autenticado: true });
  });
});

describe('conferencia do numero conectado', () => {
  it('passa quando bate, ignorando pontuacao', () => {
    expect(conferirNumero('5511968662120', '+55 11 96866-2120')).toEqual({
      ok: true,
      motivo: 'confere',
    });
  });

  it('acusa quando o QR foi escaneado com o telefone errado', () => {
    const r = conferirNumero('5511997629357', '5511968662120');
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ motivo: 'divergente', conectado: '5511997629357' });
  });

  it('sem numero esperado nao inventa aprovacao — diz que nao conferiu', () => {
    expect(conferirNumero('5511968662120', '')).toEqual({
      ok: true,
      motivo: 'sem-numero-esperado',
    });
  });
});

describe('gravacao do slot ativo', () => {
  it('cria a pasta base se ainda nao existir', async () => {
    const novo = join(base, 'fundo', 'whatsapp');
    await gravarSlotAtivo(novo, 2);
    const bruto = await readFile(join(novo, 'slot-ativo.json'), 'utf8');
    expect(JSON.parse(bruto).slot).toBe(2);
  });
});
