/**
 * Normalizacao de telefone brasileiro.
 *
 * Saida: E.164 sem o "+", ex: "5519999998888". E esse valor que vira a
 * chave de deduplicacao de prioridade 1 e o destino do WhatsApp.
 *
 * REGRA CENTRAL: nunca inventar digito. Se o numero nao tem informacao
 * suficiente para ser discado com seguranca, o resultado e `null` e a
 * linha entra como "sem telefone" — nunca como um numero remendado.
 * Um digito errado nao da erro: entrega a mensagem para outra pessoa.
 */

const DDI_BRASIL = '55';

/** DDDs validos no Brasil. Um DDD inexistente invalida o numero. */
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export interface TelefoneNormalizado {
  /** E.164 sem "+". `null` quando nao foi possivel normalizar. */
  e164: string | null;
  ddi: string | null;
  ddd: string | null;
  numero: string | null;
  /** true para celular (9 digitos comecando com 9). */
  celular: boolean;
  /** Preenchido quando e164 e null: explica por que. */
  motivoInvalido: string | null;
}

const INVALIDO = (motivo: string): TelefoneNormalizado => ({
  e164: null, ddi: null, ddd: null, numero: null,
  celular: false, motivoInvalido: motivo,
});

/**
 * Normaliza um telefone brasileiro para E.164.
 *
 * Aceita praticamente qualquer formatacao de planilha:
 *   "(19) 99999-8888", "+55 19 99999 8888", "19999998888",
 *   "19 3232-1010", "tel: 19 99999-8888"
 *
 * @param ddiPadrao DDI assumido quando o numero nao traz codigo de pais.
 *                  Vem de `settings['leads.telefone_ddi_padrao']`.
 */
export function normalizarTelefone(
  bruto: string | null | undefined,
  ddiPadrao: string = DDI_BRASIL
): TelefoneNormalizado {
  if (bruto == null) return INVALIDO('telefone ausente');

  const texto = String(bruto).trim();
  if (texto === '') return INVALIDO('telefone vazio');

  // Planilhas frequentemente trazem varios numeros na mesma celula.
  // Usamos o primeiro — e o principal na convencao do Google Maps.
  const primeiro = texto.split(/[\/;]|\s{2,}| ou /i)[0] ?? texto;

  let digitos = primeiro.replace(/\D/g, '');
  if (digitos === '') return INVALIDO('nenhum digito encontrado');

  // ---------------------------------------------------------------
  // "00" = prefixo de discagem internacional
  //
  // "00351912345678" e o MESMO numero que "+351912345678" — o "00" e
  // como se disca para fora do pais, exatamente o papel do "+". Muita
  // planilha europeia vem assim.
  //
  // Sem este tratamento o numero caia em "longo demais" e o lead
  // inteiro entrava como "sem telefone". Um detalhe de formatacao da
  // planilha nao pode decidir se voce consegue falar com a pessoa.
  //
  // O corte exige 12 digitos porque "00" seguido de menos que isso nao
  // e um internacional plausivel — e um numero brasileiro que comeca
  // com zeros de operadora, tratado logo abaixo.
  // ---------------------------------------------------------------
  let internacionalExplicito = primeiro.trim().startsWith('+');
  if (!internacionalExplicito && digitos.startsWith('00') && digitos.length >= 12) {
    digitos = digitos.slice(2);
    internacionalExplicito = true;
  }

  // ---------------------------------------------------------------
  // DDI ESTRANGEIRO CONFIGURADO
  //
  // `ddiPadrao` sai de `settings['leads.telefone_ddi_padrao']`. Quando
  // ele NAO e 55, a planilha e de outro pais e as regras brasileiras
  // (DDD de dois digitos, celular comecando com 9) nao valem — aplicar
  // elas rejeitaria numeros perfeitamente validos.
  //
  // Aqui nao ha validacao por pais: nao da para conhecer as regras de
  // todos, e inventar uma quase-regra rejeitaria numeros bons. O que se
  // garante e o tamanho E.164 (8 a 15 digitos) e que o DDI apareca
  // exatamente uma vez.
  // ---------------------------------------------------------------
  if (ddiPadrao !== DDI_BRASIL) {
    // Ja traz o DDI configurado? Entao ele nao deve ser somado de novo.
    const jaTemDdi = digitos.startsWith(ddiPadrao) && digitos.length > ddiPadrao.length + 5;
    const completo = jaTemDdi ? digitos : `${ddiPadrao}${digitos}`;

    if (completo.length < 8 || completo.length > 15) {
      return INVALIDO(
        `numero com tamanho invalido para E.164 (${completo.length} digitos)`
      );
    }
    // A checagem e sobre a parte NACIONAL, nao sobre o numero inteiro:
    // "351000000000" nao e uma sequencia repetida vista de fora, mas
    // "000000000" e — e e esse pedaco que veio da planilha.
    const nacional = completo.slice(ddiPadrao.length);
    if (/^(\d)\1+$/.test(nacional)) {
      return INVALIDO('numero e uma sequencia repetida');
    }
    return {
      e164: completo,
      ddi: ddiPadrao,
      ddd: null,
      numero: nacional,
      celular: false,
      motivoInvalido: null,
    };
  }

  // Notacao internacional explicita, com o DDI padrao ainda em 55.
  if (internacionalExplicito && !digitos.startsWith(DDI_BRASIL)) {
    // Numero estrangeiro: nao sabemos validar. Devolvemos como veio,
    // sem tentar consertar.
    if (digitos.length < 8 || digitos.length > 15) {
      return INVALIDO('numero internacional com tamanho invalido');
    }
    return {
      e164: digitos, ddi: null, ddd: null, numero: digitos,
      celular: false, motivoInvalido: null,
    };
  }

  // Remove o DDI brasileiro, se presente
  if (digitos.startsWith(DDI_BRASIL) && digitos.length >= 12) {
    digitos = digitos.slice(DDI_BRASIL.length);
  }

  // Remove o zero de operadora: "019 9999-8888"
  if (digitos.length >= 11 && digitos.startsWith('0')) {
    digitos = digitos.replace(/^0+/, '');
  }

  // Sem DDD nao da para discar. NAO adivinhamos um.
  if (digitos.length === 8 || digitos.length === 9) {
    return INVALIDO('telefone sem DDD — nao e possivel determinar a regiao');
  }

  if (digitos.length < 10) {
    return INVALIDO(`telefone curto demais (${digitos.length} digitos)`);
  }
  if (digitos.length > 11) {
    return INVALIDO(`telefone longo demais (${digitos.length} digitos)`);
  }

  const ddd = digitos.slice(0, 2);
  const numero = digitos.slice(2);

  if (!DDDS_VALIDOS.has(Number.parseInt(ddd, 10))) {
    return INVALIDO(`DDD ${ddd} nao existe`);
  }

  // Celular: 9 digitos comecando com 9. Fixo: 8 digitos comecando 2-5.
  const celular = numero.length === 9;

  if (celular && !numero.startsWith('9')) {
    return INVALIDO('celular de 9 digitos precisa comecar com 9');
  }
  if (!celular && !/^[2-5]/.test(numero)) {
    return INVALIDO('telefone fixo com prefixo invalido');
  }

  // Rejeita sequencias obviamente falsas (0000000000, 1111111111)
  if (/^(\d)\1+$/.test(digitos)) {
    return INVALIDO('numero e uma sequencia repetida');
  }

  return {
    e164: `${ddiPadrao}${ddd}${numero}`,
    ddi: ddiPadrao,
    ddd,
    numero,
    celular,
    motivoInvalido: null,
  };
}

/** Atalho: devolve so o E.164 ou null. */
export function telefoneE164(
  bruto: string | null | undefined,
  ddiPadrao: string = DDI_BRASIL
): string | null {
  return normalizarTelefone(bruto, ddiPadrao).e164;
}

/** Formata para exibicao: "(19) 99999-8888". */
export function formatarTelefone(e164: string | null): string | null {
  if (!e164) return null;
  const semDdi = e164.startsWith(DDI_BRASIL) ? e164.slice(2) : e164;
  if (semDdi.length === 11) {
    return `(${semDdi.slice(0, 2)}) ${semDdi.slice(2, 7)}-${semDdi.slice(7)}`;
  }
  if (semDdi.length === 10) {
    return `(${semDdi.slice(0, 2)}) ${semDdi.slice(2, 6)}-${semDdi.slice(6)}`;
  }
  return e164;
}
