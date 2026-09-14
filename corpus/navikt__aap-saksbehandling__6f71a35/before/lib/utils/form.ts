import { ArbeidsevneNedsattValg } from 'lib/types/types';

import { ValuePair } from 'components/form/FormField';

export enum Behovstype {
  MANUELT_SATT_PÅ_VENT_KODE = '9001',
  VURDER_BRUDD_11_7_KODE = '4101',
  VURDER_BRUDD_11_9_KODE = '4201',
  AVKLAR_STUDENT_KODE = '5001',
  AVKLAR_STUDENT_KODE_V2 = '5037',
  OVERSTYR_IKKE_OPPFYLT_MELDEPLIKT_KODE = '5002',
  AVKLAR_SYKDOM_KODE = '5003',
  FASTSETT_ARBEIDSEVNE_KODE = '5004',
  FRITAK_MELDEPLIKT_KODE = '5005',
  AVKLAR_BISTANDSBEHOV_KODE = '5006',
  VURDER_SYKEPENGEERSTATNING_KODE = '5007',
  FASTSETT_BEREGNINGSTIDSPUNKT_KODE = '5008',
  AVKLAR_BARNETILLEGG_KODE = '5009',
  AVKLAR_SONINGSFORRHOLD = '5010',
  AVKLAR_HELSEINSTITUSJON = '5011',
  AVKLAR_SAMORDNING_GRADERING = '5012',
  YRKESSKADE_KODE = '5013',
  FASTSETT_YRKESSKADEINNTEKT = '5014',
  EFFEKTUER_11_7_KODE = '5015',
  AVKLAR_LOVVALG_MEDLEMSKAP = '5017',
  AVKLAR_FORUTGÅENDE_MEDLEMSKAP = '5020',
  MANUELL_OVERSTYRING_LOVVALG = '5021',
  MANUELL_OVERSTYRING_MEDLEMSKAP = '5022',
  AVKLAR_SAMORDNING_UFORE = '5024',
  AVKLAR_SAMORDNING_ANDRE_STATLIGE_YTELSER = '5027',
  VURDER_TREKK_AV_SØKNAD_KODE = '5028',
  AVKLAR_SAMORDNING_ARBEIDSGIVER = '5030',
  OVERGANG_ARBEID = '5032',
  AVBRYT_REVURDERING_KODE = '5033',
  AVKLAR_SAMORDNING_SYKESTIPEND_KODE = '5034',
  AVKLAR_SAMORDNING_BARNEPENSJON_KODE = '5036',
  VURDER_KRAV_KODE = '5038',
  AVKLAR_STØNADSPERIODE_KODE = '5039',
  OVERGANG_UFORE = '5031',
  SKRIV_VEDTAKSBREV_SAKSBEHANDLER_KODE = '5041',
  SKRIV_BREV_KODE = '5050',
  SKRIV_VEDTAKSBREV_KODE = '5051',
  SKRIV_FORHÅNDSVARSEL_AKTIVITETSPLIKT_BREV_KODE = '5052',
  SYKDOMSVURDERING_BREV_KODE = '5053',
  BEKREFT_VURDERINGER_OPPFØLGING = '5054',
  FORESLÅ_UTTAK_KODE = '5096',
  KVALITETSSIKRING_KODE = '5097',
  FORESLÅ_VEDTAK_KODE = '5098',
  FATTE_VEDTAK_KODE = '5099',
  REFUSJON_KRAV_KODE = '5026',
  VURDER_RETTIGHETSPERIODE = '5029',
  FASTSETT_PÅKLAGET_BEHANDLING = '5999',
  VURDER_FORMKRAV = '6000',
  FASTSETT_BEHANDLENDE_ENHET = '6001',
  VURDER_KLAGE_KONTOR = '6002',
  VURDER_KLAGE_NAY = '6003',
  SKRIV_FORHÅNDSVARSEL_KLAGE_FORMKRAV_BREV_KODE = '6005',
  KLAGE_OPPSUMMERING = '6006',
  HÅNDTER_SVAR_FRA_ANDREINSTANS = '6008',
  FASTSETT_FULLMEKTIG = '6009',
  TREKK_KLAGE_KODE = '6010',
  SAMORDNING_REFUSJONS_KRAV = '5056',
  ETABLERING_EGEN_VIRKSOMHET_KODE = '5058',
  FASTSETT_MANUELL_INNTEKT = '7001',
  AVKLAR_OPPFØLGINGSBEHOV_NAY = '8002',
  AVKLAR_OPPFØLGINGSBEHOV_LOKALKONTOR = '8001',
  OPPHOLDSKRAV_KODE = '5035',
  ARBEIDSOPPTRAPPING_KODE = '5057',
  VURDER_INNTEKTSBORTFALL = '5040',
  FASTSETT_VEDTAKSLENGDE = '5059',
  FORESLÅ_VEDTAK_VEDTAKSLENGDE = '5060',
  AVBRYT_AKTIVITETSPLIKTBEHANDLING = '4301',
  VURDER_AVSLAG_11_27 = '5042',
}

type BehovsKode = `${Behovstype}`;

export function mapBehovskodeTilBehovstype(kode: BehovsKode): string {
  switch (kode) {
    case '4101':
      return '§ 11-7 Medlemmets aktivitetsplikt';
    case '4201':
      return '§ 11-9 Aktivitetsplikt';
    case '4301':
      return 'Avbryt behandling';
    case '5001':
      return '§ 11-14 Student';
    case '5002':
      return '§ 11-10 andre ledd. Perioder uten overholdt meldeplikt';
    case '5003':
      return '§ 11-5 Nedsatt arbeidsevne og krav til årsakssammenheng';
    case '5004':
      return '§ 11-23 andre ledd. Arbeidsevne som ikke er utnyttet';
    case '5005':
      return '§ 11-10 tredje ledd. Unntak fra meldeplikt';
    case '5006':
      return '§ 11-6 Behov for bistand til å skaffe seg eller beholde arbeid';
    case '5007':
      return '§ 11-13 AAP som sykepengeerstatning';
    case '5008':
      return '§ 11-19 Tidspunktet da arbeidsevnen ble nedsatt, jf. § 11-5';
    case '5009':
      return '§ 11-20 tredje og fjerde ledd barnetillegg';
    case '5037':
      return '§ 11-14 Student';
    case '5098':
      return 'Foreslå vedtak';
    case '5099':
      return 'Fatte vedtak';
    case '5096':
      return 'Foreslå uttak';
    case '5097':
      return 'Kvalitetssikring';
    case '9001':
      return 'Manuelt satt på vent';
    case '5010':
      return '§ 11-26 Soning';
    case '5011':
      return '§ 11-25 Helseinstitusjon';
    case '5012':
      return '§§ 11-27 / 11-28 Forholdet til andre fulle eller reduserte folketrygdytelser';
    case '5013':
      return '§ 11-22 AAP ved yrkesskade';
    case '5014':
      return 'Yrkesskade grunnlagsberegning §§ 11-19 / 11-22';
    case '5015':
      return '§ 11-7 Bidrar ikke til egen avklaring / behandling';
    case '5017':
      return 'Lovvalg og medlemskap ved søknadstidspunkt';
    case '5020':
      return '§ 11-2 Forutgående medlemskap';
    case '5021':
      return 'Overstyr lovvalg';
    case '5024':
      return '§ 11-28 Samordning med delvis uføre';
    case '5026':
      return 'Sosialstønad refusjonskrav';
    case '5027':
      return 'Andre ytelser til avregning';
    case '5028':
      return 'Vurder trekk av søknad';
    case '5030':
      return '§ 11-24 Reduksjon av AAP på grunn av ytelser fra arbeidsgiver';
    case '5031':
      return '§ 11-18 AAP under behandling av krav om uføretrygd';
    case '5032':
      return '§ 11-17 AAP i perioden som arbeidssøker';
    case '5033':
      return 'Avbryt revurdering';
    case '5022':
      return 'Overstyr § 11-2 forutgående medlemskap';
    case '5034':
      return '§ 11-29 Sykestipend fra lånekassen';
    case '5035':
      return '§ 11-3 Oppholdskrav';
    case '5036':
      return '§ 11-27 Samordning barnepensjon';
    case '5038':
      return 'Vurder krav';
    case '5039':
      return 'Avklar stønadsperiode';
    case '5040':
      return '§ 11-4 andre ledd. Krav om inntektsbortfall etter fylte 62 år';
    case '5041':
      return 'Skriv brev';
    case '5042':
      return '§ 11-27 Mulig avslag pga. annen full folketrygdytelse';
    case '5050':
      return 'Skriv brev';
    case '5051':
      return 'Skriv brev';
    case '5052':
      return 'Skriv forhåndsvarsel aktivitetsplikt';
    case '5053':
      return 'Individuell begrunnelse for §§ 11-5 og 11-6 til vedtaksbrev';
    case '5054':
      return 'Bekreft vurderinger';
    case '5029':
      return '§ 22-13 syvende ledd';
    case '5999':
      return 'Fastsett påklaget behandling';
    case '6000':
      return 'Formkrav';
    case '6001':
      return 'Fastsett behandlende enhet';
    case '6002':
      return 'Vurder klage';
    case '6003':
      return 'Behandle klage';
    case '6005':
      return 'Skriv forhåndsvarsel klage';
    case '6006':
      return 'Oppsummering av klagebehandlingen';
    case '6008':
      return 'Vurder konsekvens av svar fra Nav Klaginstans';
    case '6009':
      return 'Fastsett fullmektig/verge';
    case '6010':
      return 'Trekk klage';
    case '5056':
      return 'Refusjonskrav tjenestepensjon';
    case '7001':
      return 'Pensjonsgivende inntekt mangler (§ 11-19)';
    case '8001':
      return 'Avklar oppfølgingsbehov lokalkontor';
    case '8002':
      return 'Avklar oppfølgingsbehov NAY';
    case '5057':
      return '§ 11-23 sjette ledd. Arbeidsopptrapping (valgfritt)';
    case '5058':
      return '§ 11-15 Etablering av egen virksomhet (valgfritt)';
    case '5059':
      return 'Fastsett vedtaksperiode';
    case '5060':
      return 'Foreslå vedtak vedtakslengde';
  }
}

export enum JaEllerNei {
  Ja = 'ja',
  Nei = 'nei',
}

export const JaEllerNeiOptions: ValuePair[] = [
  { label: 'Ja', value: JaEllerNei.Ja },
  { label: 'Nei', value: JaEllerNei.Nei },
];

export const getTrueFalseEllerUndefined = (value?: JaEllerNei): boolean | undefined => {
  if (!value) {
    return undefined;
  }
  return value === JaEllerNei.Ja;
};

export const getJaEllerNei = (value: boolean) => {
  return value ? JaEllerNei.Ja : JaEllerNei.Nei;
};

export const getJaNeiEllerUndefined = (value?: boolean | null) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  return value ? JaEllerNei.Ja : JaEllerNei.Nei;
};

export const getStringEllerUndefined = (value?: number | string | null) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  return value.toString();
};

export function getJaNeiEllerIkkeBesvart(value?: boolean | null) {
  if (value === undefined || value === null) {
    return 'Ikke besvart';
  }
  return value ? JaEllerNei.Ja : JaEllerNei.Nei;
}

export enum JaNeiEllerForbigåendeTekst {
  Ja = 'Ja',
  Nei = 'Nei',
  Forbigående = 'Ja, men brukeren har kun forbigående problemer med å komme i arbeid og skal vurderes for AAP som sykepengeerstatning etter § 11-13',
  NeiMenStudent = 'Nei, men brukeren har avbrutt et studie på grunn av sykdom eller skade og skal vurderes for AAP til studenter etter § 11-14',
}

export function getJaNeiJaForbigåendeEllerIkkeBesvart(value?: ArbeidsevneNedsattValg | null) {
  if (value === undefined || value === null) {
    return 'Ikke besvart';
  }
  switch (value) {
    case 'JA_FORBIGÅENDE_PROBLEMER':
      return JaNeiEllerForbigåendeTekst.Forbigående;
    case 'JA':
      return JaNeiEllerForbigåendeTekst.Ja;
    case 'NEI':
      return JaNeiEllerForbigåendeTekst.Nei;
    case 'NEI_MEN_STUDENT':
      return JaNeiEllerForbigåendeTekst.NeiMenStudent;
  }
}
