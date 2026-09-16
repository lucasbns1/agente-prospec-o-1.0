/**
 * Os dois numeros de WhatsApp, e qual deles esta ativo.
 *
 * ============================================================
 * UM DE CADA VEZ, E NUNCA OS DOIS
 * ============================================================
 * O WhatsApp derruba as duas pontas quando duas sessoes disputam a
 * mesma conta, e o worker e um processo so. Aqui a regra e explicita:
 * existe UM numero ativo. Trocar e desconectar um e conectar o outro,
 * nunca somar.
 *
 * ============================================================
 * CADA NUMERO TEM A PROPRIA PASTA — E ISSO E O QUE SALVA O QR
 * ============================================================
 * Credencial, arquivo de mensagens e o mapa LID<->telefone vivem em
 * disco, ao lado da sessao. Se os dois numeros dividissem a pasta, o
 * segundo login sobrescreveria o primeiro: voltar para o numero 1
 * pediria QR de novo e o historico dele estaria misturado com o do 2.
 *
 * Com pastas separadas, trocar nao apaga nada. Voce escaneia cada numero
 * UMA vez e depois alterna a vontade.
 *
 * ============================================================
 * O NUMERO 1 FICA NA PASTA ANTIGA, DE PROPOSITO
 * ============================================================
 * A sessao que ja existe hoje mora na raiz de `WHATSAPP_SESSION_PATH`.
 * Se o numero 1 passasse a morar num subdiretorio, essa sessao ficaria
 * orfa e o primeiro efeito da novidade seria pedir QR de um numero que
 * ja estava conectado — perdendo junto o arquivo de mensagens e o mapa
 * LID que custou caro para recuperar.
 *
 * Entao o numero 1 E a pasta antiga. So o numero 2 estreia pasta nova.
 * Nao e elegante; e o que nao quebra nada de quem ja esta rodando.
 */

export type NumeroWhatsApp = '1' | '2';

export const NUMEROS_WHATSAPP: readonly NumeroWhatsApp[] = ['1', '2'];

/** Chave na tabela `settings`. Sobrevive a reinicio de tudo. */
export const CHAVE_SETTING_NUMERO_ATIVO = 'whatsapp.numero_ativo';

/** Telefone que cada numero mostrou ao autenticar, para a tela rotular. */
export const CHAVE_SETTING_TELEFONES = 'whatsapp.telefones_por_numero';

/**
 * Canal de pub/sub pelo qual a tela pede a troca ao worker.
 *
 * A API nao abre conexao com o WhatsApp — quem segura a sessao e o
 * worker. Entao trocar de numero nao e algo que a API faz: e algo que
 * ela PEDE. Esta e a primeira vez que a tela comanda o worker; ate aqui
 * ela so lia o retrato publicado no Redis.
 */
export const CANAL_COMANDO = 'prospector:canal:comando';

export interface ComandoTrocarNumero {
  tipo: 'trocar-numero';
  numero: NumeroWhatsApp;
}

export type ComandoCanal = ComandoTrocarNumero;

export function ehNumeroWhatsApp(valor: unknown): valor is NumeroWhatsApp {
  return valor === '1' || valor === '2';
}

/**
 * A pasta de sessao de um numero.
 *
 * O numero 1 devolve a base sem sufixo — ver o bloco sobre a pasta
 * antiga la em cima. Mudar isto desconecta a sessao que esta no ar.
 */
export function caminhoDaSessao(base: string, numero: NumeroWhatsApp): string {
  const limpa = base.replace(/[/\\]+$/, '');
  return numero === '1' ? limpa : `${limpa}-numero-${numero}`;
}

/**
 * Le o numero ativo de um valor vindo do banco, com padrao seguro.
 *
 * Qualquer coisa estranha vira '1' — o numero que ja estava em uso antes
 * desta funcionalidade existir. Na duvida, siga o que ja estava
 * acontecendo: um valor corrompido nao pode fazer a ferramenta acordar
 * conectando no numero errado.
 */
export function numeroAtivoDeSetting(valor: unknown): NumeroWhatsApp {
  if (ehNumeroWhatsApp(valor)) return valor;
  // O Prisma devolve Json: um valor gravado como string vem como string,
  // mas um objeto `{ numero: '2' }` tambem e plausivel se alguem editar
  // o banco na mao.
  if (valor && typeof valor === 'object' && 'numero' in valor) {
    const interno = (valor as { numero: unknown }).numero;
    if (ehNumeroWhatsApp(interno)) return interno;
  }
  return '1';
}
