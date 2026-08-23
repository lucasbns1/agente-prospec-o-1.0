/**
 * "A coluna do telefone parece errada".
 *
 * ============================================================
 * O CASO QUE ORIGINOU ISTO
 * ============================================================
 * Duas planilhas do Google Maps entraram com 54 leads. Todos com
 * telefone recusado, e os valores eram: "15", "20", "3", "5", "21", "4".
 *
 * Não são telefones truncados — é a CONTAGEM DE AVALIAÇÕES. No arquivo,
 * a avaliação estava numa coluna e o número de avaliações na seguinte; o
 * telefone morava dez colunas depois.
 *
 * O sistema importou os 54, contou "54 importados", e a pergunta só
 * apareceu quando a campanha mostrou "0 leads". A análise SABIA —
 * `semTelefone` era 25 de 25 — mas era um número entre outros.
 *
 * ============================================================
 * O RISCO DO LADO OPOSTO
 * ============================================================
 * Um alarme que dispara à toa ensina a pessoa a ignorar o alarme. O
 * segundo bloco daqui existe para isso: os casos em que ele tem que
 * ficar calado.
 */
import { describe, expect, it } from 'vitest';
import {
  avaliarColunaTelefone,
  PROPORCAO_SUSPEITA,
  MINIMO_PARA_OPINAR,
} from '../packages/domain/src/index.js';

describe('acusa a coluna trocada', () => {
  it('o caso real: contagem de avaliações no lugar do telefone', () => {
    const a = avaliarColunaTelefone({
      novos: 25,
      semTelefone: 25,
      brutosRecusados: ['15', '20', '3', '5', '21'],
    });

    expect(a).not.toBeNull();
    expect(a!.proporcaoSemTelefone).toBe(1);
    // Os valores entram na mensagem: sem eles, "confira o mapeamento"
    // não diz qual coluna nem por quê.
    expect(a!.mensagem).toContain('"15"');
    expect(a!.mensagem).toContain('25 de 25');
    expect(a!.exemplos).toHaveLength(3);
  });

  it('coluna não mapeada dá uma mensagem diferente', () => {
    // "Mapeou a coluna errada" e "não mapeou coluna nenhuma" pedem
    // consertos diferentes, e a mensagem tem que dizer qual é.
    const a = avaliarColunaTelefone({
      novos: 30,
      semTelefone: 30,
      brutosRecusados: [null, null, '', undefined],
    });

    expect(a).not.toBeNull();
    expect(a!.exemplos).toEqual([]);
    expect(a!.mensagem).toContain('não tem telefone nenhum');
    expect(a!.mensagem).not.toContain('""');
  });

  it('dispara no limiar, e não só no caso extremo', () => {
    const a = avaliarColunaTelefone({
      novos: 10,
      semTelefone: 8, // exatamente 80%
      brutosRecusados: ['1', '2'],
    });
    expect(a).not.toBeNull();
  });
});

describe('fica calado quando deve', () => {
  it('planilha boa com alguns sem telefone não acusa nada', () => {
    // Normal: o Google Maps nem sempre traz telefone. Acusar aqui faria
    // o alarme perder o sentido.
    const a = avaliarColunaTelefone({
      novos: 100,
      semTelefone: 12,
      brutosRecusados: [null, null],
    });
    expect(a).toBeNull();
  });

  it('logo abaixo do limiar não acusa', () => {
    const a = avaliarColunaTelefone({
      novos: 10,
      semTelefone: 7, // 70%
      brutosRecusados: ['1'],
    });
    expect(a).toBeNull();
  });

  it('amostra pequena não sustenta a acusação', () => {
    // Três leads e dois sem telefone passa de 60% sem significar nada.
    const a = avaliarColunaTelefone({
      novos: 3,
      semTelefone: 3,
      brutosRecusados: ['1', '2', '3'],
    });
    expect(a).toBeNull();
    expect(MINIMO_PARA_OPINAR).toBeGreaterThan(3);
  });

  it('planilha perfeita não acusa', () => {
    const a = avaliarColunaTelefone({
      novos: 50,
      semTelefone: 0,
      brutosRecusados: [],
    });
    expect(a).toBeNull();
  });

  it('arquivo vazio não quebra nem acusa', () => {
    expect(
      avaliarColunaTelefone({ novos: 0, semTelefone: 0, brutosRecusados: [] })
    ).toBeNull();
  });

  it('o limiar é alto de propósito', () => {
    // Uma trava de revisão: baixar isto faz o alarme disparar em
    // planilha boa, e um alarme que grita à toa é ignorado.
    expect(PROPORCAO_SUSPEITA).toBeGreaterThanOrEqual(0.75);
  });
});
