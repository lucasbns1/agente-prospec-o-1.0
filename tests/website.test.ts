/**
 * Testes da classificacao de website.
 *
 * Esta e a regra que decide quem entra na sua lista de prospeccao.
 * Um falso "tem site" perde um lead. Um falso "sem site" faz voce
 * abordar alguem que ja tem site dizendo que ele nao tem.
 */
import { describe, expect, it } from 'vitest';
import {
  classificarWebsite,
  temSiteProprio,
  casaDominio,
  extrairPerfilSocial,
  type DominioSocial,
} from '../packages/domain/src/normalization/website.js';

/** Espelha exatamente o que o seed grava em `social_domains`. */
const SOCIAIS: DominioSocial[] = [
  { dominio: 'instagram.com', incluirSubdominios: true, ativo: true },
  { dominio: 'facebook.com', incluirSubdominios: true, ativo: true },
  { dominio: 'fb.com', incluirSubdominios: true, ativo: true },
];

const classificar = (url: string | null | undefined) =>
  classificarWebsite(url, SOCIAIS);

describe('SEM SITE — campo ausente ou vazio', () => {
  it.each([
    [null, 'null'],
    [undefined, 'undefined'],
    ['', 'string vazia'],
    ['   ', 'so espacos'],
    ['-', 'hifen'],
    ['N/A', 'N/A'],
    ['não', 'nao'],
    ['sem site', 'texto "sem site"'],
  ])('%s (%s) => SEM SITE', (entrada) => {
    const r = classificar(entrada as string | null | undefined);
    expect(r.semSiteProprio).toBe(true);
    expect(r.status).toBe('NAO_INFORMADO');
  });
});

describe('SEM SITE — Instagram', () => {
  it.each([
    'instagram.com/maria',
    'www.instagram.com/maria',
    'https://instagram.com/maria',
    'https://www.instagram.com/maria',
    'http://instagram.com/psicologa.maria',
    'https://www.instagram.com/maria/?hl=pt-br',
    'INSTAGRAM.COM/MARIA',
    'm.instagram.com/maria',
    'br.instagram.com/maria',
  ])('%s => REDE_SOCIAL', (url) => {
    const r = classificar(url);
    expect(r.status).toBe('REDE_SOCIAL');
    expect(r.semSiteProprio).toBe(true);
    expect(r.dominioSocial).toBe('instagram.com');
  });
});

describe('SEM SITE — Facebook', () => {
  it.each([
    'facebook.com/nome',
    'www.facebook.com/nome',
    'https://facebook.com/nome',
    'https://www.facebook.com/nome',
    'https://m.facebook.com/clinica.vida',
    'fb.com/nome',
    'https://www.facebook.com/profile.php?id=123456',
  ])('%s => REDE_SOCIAL', (url) => {
    const r = classificar(url);
    expect(r.status).toBe('REDE_SOCIAL');
    expect(r.semSiteProprio).toBe(true);
  });
});

describe('COM SITE — dominio proprio', () => {
  it.each([
    'psicologiamaria.com.br',
    'www.psicologiamaria.com.br',
    'https://psicologiamaria.com.br',
    'https://www.clinicax.com.br/contato',
    'http://anacosta.psi.br',
    'consultoriosaude.com',
  ])('%s => SITE_PROPRIO', (url) => {
    const r = classificar(url);
    expect(r.status).toBe('SITE_PROPRIO');
    expect(r.semSiteProprio).toBe(false);
    expect(r.dominioSocial).toBeNull();
  });
});

describe('casamento de dominio e por label, nao por sufixo de string', () => {
  it('NAO classifica "meuinstagram.com" como Instagram', () => {
    const r = classificar('https://meuinstagram.com.br');
    expect(r.status).toBe('SITE_PROPRIO');
  });

  it('NAO classifica "facebookmarketing.com.br" como Facebook', () => {
    const r = classificar('https://facebookmarketing.com.br');
    expect(r.status).toBe('SITE_PROPRIO');
  });

  it('casaDominio respeita a fronteira do label', () => {
    const social: DominioSocial = {
      dominio: 'instagram.com', incluirSubdominios: true, ativo: true,
    };
    expect(casaDominio('instagram.com', social)).toBe(true);
    expect(casaDominio('www.instagram.com', social)).toBe(true);
    expect(casaDominio('m.instagram.com', social)).toBe(true);
    expect(casaDominio('meuinstagram.com', social)).toBe(false);
    expect(casaDominio('instagram.com.br', social)).toBe(false);
  });

  it('respeita incluirSubdominios = false', () => {
    const social: DominioSocial = {
      dominio: 'instagram.com', incluirSubdominios: false, ativo: true,
    };
    expect(casaDominio('instagram.com', social)).toBe(true);
    expect(casaDominio('m.instagram.com', social)).toBe(false);
  });
});

describe('a lista vem do banco, nao do codigo', () => {
  it('um dominio novo cadastrado passa a valer sem mudar codigo', () => {
    const comLinktree: DominioSocial[] = [
      ...SOCIAIS,
      { dominio: 'linktr.ee', incluirSubdominios: true, ativo: true },
    ];
    expect(classificarWebsite('linktr.ee/maria', SOCIAIS).status).toBe('SITE_PROPRIO');
    expect(classificarWebsite('linktr.ee/maria', comLinktree).status).toBe('REDE_SOCIAL');
  });

  it('dominio desativado deixa de valer', () => {
    const desativado: DominioSocial[] = [
      { dominio: 'instagram.com', incluirSubdominios: true, ativo: false },
    ];
    expect(classificarWebsite('instagram.com/maria', desativado).status).toBe('SITE_PROPRIO');
  });

  it('lista vazia: tudo que for URL valida e site proprio', () => {
    expect(classificarWebsite('instagram.com/maria', []).status).toBe('SITE_PROPRIO');
  });
});

describe('URLs invalidas', () => {
  it.each(['nao é uma url', 'apenas texto', 'javascript:alert(1)', '###'])(
    '%s => INVALIDO e entra na prospeccao',
    (url) => {
      const r = classificar(url);
      expect(r.status).toBe('INVALIDO');
      // Nao confirmamos site proprio -> o lead permanece prospectavel.
      expect(r.semSiteProprio).toBe(true);
    }
  );
});

describe('formato markdown do Instant Data Scraper', () => {
  it('extrai a URL de dentro do link markdown', () => {
    const r = classificar('[www.instagram.com/maria](https://www.instagram.com/maria)');
    expect(r.status).toBe('REDE_SOCIAL');
  });
  it('funciona tambem para site proprio', () => {
    const r = classificar('[psicologiamaria.com.br](https://psicologiamaria.com.br)');
    expect(r.status).toBe('SITE_PROPRIO');
  });
});

describe('temSiteProprio — regra do funil', () => {
  it('so SITE_PROPRIO conta como "tem site"', () => {
    expect(temSiteProprio('SITE_PROPRIO')).toBe(true);
    expect(temSiteProprio('REDE_SOCIAL')).toBe(false);
    expect(temSiteProprio('NAO_INFORMADO')).toBe(false);
    expect(temSiteProprio('INVALIDO')).toBe(false);
    expect(temSiteProprio('NAO_VERIFICADO')).toBe(false);
  });
});

describe('extrairPerfilSocial', () => {
  it('extrai perfil do Instagram', () => {
    expect(extrairPerfilSocial('instagram.com/maria', 'instagram')).toBe(
      'https://instagram.com/maria'
    );
  });
  it('extrai perfil do Facebook', () => {
    expect(extrairPerfilSocial('fb.com/clinica', 'facebook')).toBe(
      'https://fb.com/clinica'
    );
  });
  it('devolve null quando a rede nao bate', () => {
    expect(extrairPerfilSocial('instagram.com/maria', 'facebook')).toBeNull();
    expect(extrairPerfilSocial('site.com.br', 'instagram')).toBeNull();
    expect(extrairPerfilSocial(null, 'instagram')).toBeNull();
  });
});
