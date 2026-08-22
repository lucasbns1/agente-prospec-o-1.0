/**
 * O agrupamento de quem recebeu e ficou calado.
 *
 * A regra tem duas decisões que não são óbvias e que este arquivo trava:
 * o grupo do lead é a MAIOR etapa que saiu para ele, e os grupos vêm do
 * mais avançado para o menos.
 */
import { describe, expect, it } from 'vitest';
import {
  agruparSemResposta,
  type EnvioSemResposta,
} from '../packages/domain/src/index.js';

let seq = 0;
function envio(p: Partial<EnvioSemResposta> & { leadId: string; ordem: number }): EnvioSemResposta {
  seq += 1;
  return {
    nome: `Lead ${p.leadId}`,
    categoria: 'Barbearia',
    bairro: 'Centro',
    cidade: 'São Paulo',
    temperatura: 'FRIO',
    status: 'AGUARDANDO_RESPOSTA',
    etapaNome: null,
    enviadaEm: new Date(2026, 0, 1, 12, seq),
    ...p,
  };
}

describe('agruparSemResposta', () => {
  it('sem envios, sem grupos', () => {
    expect(agruparSemResposta([])).toEqual([]);
  });

  it('um lead por grupo, contado uma vez só', () => {
    const r = agruparSemResposta([
      envio({ leadId: 'a', ordem: 1 }),
      envio({ leadId: 'b', ordem: 1 }),
    ]);

    expect(r).toHaveLength(1);
    expect(r[0]!.ordem).toBe(1);
    expect(r[0]!.total).toBe(2);
  });

  it('o lead entra pela MAIOR etapa que saiu para ele', () => {
    // Quem recebeu a 1 e a 2 e não respondeu nenhuma está no grupo da 2.
    // Contá-lo nos dois grupos infla os números e faz você trabalhar o
    // mesmo lead duas vezes.
    const r = agruparSemResposta([
      envio({ leadId: 'a', ordem: 1 }),
      envio({ leadId: 'a', ordem: 2 }),
    ]);

    expect(r).toHaveLength(1);
    expect(r[0]!.ordem).toBe(2);
    expect(r[0]!.total).toBe(1);
  });

  it('a ordem de chegada dos envios não muda o resultado', () => {
    // A consulta ordena por data, não por etapa. Se o agrupamento
    // dependesse dessa ordem, o mesmo banco daria respostas diferentes.
    const crescente = agruparSemResposta([
      envio({ leadId: 'a', ordem: 1 }),
      envio({ leadId: 'a', ordem: 3 }),
    ]);
    const decrescente = agruparSemResposta([
      envio({ leadId: 'a', ordem: 3 }),
      envio({ leadId: 'a', ordem: 1 }),
    ]);

    expect(crescente[0]!.ordem).toBe(3);
    expect(decrescente[0]!.ordem).toBe(3);
  });

  it('grupos vêm do mais avançado para o menos', () => {
    // Quem recebeu a proposta inteira e ficou calado está mais perto de
    // uma decisão do que quem ignorou a abordagem. O topo da lista tem
    // que ser onde vale gastar tempo.
    const r = agruparSemResposta([
      envio({ leadId: 'a', ordem: 1 }),
      envio({ leadId: 'b', ordem: 3 }),
      envio({ leadId: 'c', ordem: 2 }),
    ]);

    expect(r.map((g) => g.ordem)).toEqual([3, 2, 1]);
  });

  it('dentro do grupo, quem espera há mais tempo aparece primeiro', () => {
    const antigo = new Date(2026, 0, 1, 9, 0);
    const recente = new Date(2026, 0, 1, 18, 0);

    const r = agruparSemResposta([
      envio({ leadId: 'novo', ordem: 1, enviadaEm: recente }),
      envio({ leadId: 'velho', ordem: 1, enviadaEm: antigo }),
    ]);

    expect(r[0]!.leads.map((l) => l.leadId)).toEqual(['velho', 'novo']);
  });

  it('reenvio da mesma etapa move o "desde" para o mais recente', () => {
    // O silêncio começou na última vez que a mensagem saiu, não na
    // primeira: dizer "calado desde ontem" quando você reenviou hoje de
    // manhã seria falso.
    const primeiro = new Date(2026, 0, 1, 9, 0);
    const reenvio = new Date(2026, 0, 2, 9, 0);

    const r = agruparSemResposta([
      envio({ leadId: 'a', ordem: 1, enviadaEm: primeiro }),
      envio({ leadId: 'a', ordem: 1, enviadaEm: reenvio }),
    ]);

    expect(r[0]!.total).toBe(1);
    expect(r[0]!.leads[0]!.desde).toEqual(reenvio);
  });

  it('usa o nome da etapa quando ela tem um', () => {
    const r = agruparSemResposta([
      envio({ leadId: 'a', ordem: 2, etapaNome: 'Proposta' }),
    ]);

    expect(r[0]!.rotulo).toBe('Proposta');
  });

  it('cai em "Mensagem N" quando a etapa não tem nome', () => {
    const semNome = agruparSemResposta([envio({ leadId: 'a', ordem: 2 })]);
    const nomeVazio = agruparSemResposta([
      envio({ leadId: 'b', ordem: 4, etapaNome: '   ' }),
    ]);

    expect(semNome[0]!.rotulo).toBe('Mensagem 2');
    expect(nomeVazio[0]!.rotulo).toBe('Mensagem 4');
  });

  it('carrega os dados do lead para a lista ser útil sozinha', () => {
    // Sem isto a tela mostraria uma lista de ids e precisaria de uma
    // consulta por linha para ficar legível.
    const r = agruparSemResposta([
      envio({
        leadId: 'a',
        ordem: 1,
        nome: 'Barbearia do Zé',
        categoria: 'Barbearia',
        bairro: 'Centro',
        cidade: 'Campinas',
        temperatura: 'MORNO',
      }),
    ]);

    expect(r[0]!.leads[0]).toMatchObject({
      leadId: 'a',
      nome: 'Barbearia do Zé',
      categoria: 'Barbearia',
      bairro: 'Centro',
      cidade: 'Campinas',
      temperatura: 'MORNO',
    });
  });
});
