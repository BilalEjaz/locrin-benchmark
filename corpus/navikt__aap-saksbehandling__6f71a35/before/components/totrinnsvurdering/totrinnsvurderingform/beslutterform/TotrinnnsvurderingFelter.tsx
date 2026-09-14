import { PencilWritingIcon } from '@navikt/aksel-icons';
import { Link as AkselLink, Checkbox, Detail, HStack, Radio, VStack } from '@navikt/ds-react';
import { ToTrinnsVurderingGrunn } from 'lib/types/types';
import { Behovstype, JaEllerNei, JaEllerNeiOptions, mapBehovskodeTilBehovstype } from 'lib/utils/form';
import { BeslutterFeltTag } from 'lib/utils/umami/hendelserVarighet';
import Link from 'next/link';
import { FieldArrayWithId, UseFormReturn } from 'react-hook-form';

import { ValuePair } from 'components/form/FormField';
import { CheckboxWrapper } from 'components/form/checkboxwrapper/CheckboxWrapper';
import { RadioGroupWrapper } from 'components/form/radiogroupwrapper/RadioGroupWrapper';
import { TextAreaWrapper } from 'components/form/textareawrapper/TextAreaWrapper';
import { FormFieldsToTrinnsVurdering } from 'components/totrinnsvurdering/totrinnsvurderingform/TotrinnsvurderingForm';
import styles from 'components/totrinnsvurdering/totrinnsvurderingform/beslutterform/TotrinnsvurderingFelter.module.css';

interface Props {
  link: string;
  readOnly: boolean;
  erKvalitetssikring: boolean;
  index: number;
  form: UseFormReturn<FormFieldsToTrinnsVurdering>;
  field: FieldArrayWithId<FormFieldsToTrinnsVurdering, 'totrinnsvurderinger'>;
  felterOnBlur?: (hendelse: BeslutterFeltTag, tidsstempel: number) => void;
  endretSidenForrigeGang: boolean | null;
}

export const TotrinnnsvurderingFelter = ({
  readOnly,
  link,
  erKvalitetssikring,
  form,
  index,
  field,
  felterOnBlur = () => {},
  endretSidenForrigeGang,
}: Props) => {
  const grunnOptions: ValuePair<ToTrinnsVurderingGrunn>[] = [
    { label: 'Mangler i utredning før vilkårsvurderingen', value: 'MANGLENDE_UTREDNING' },
    { label: 'Mangler i vilkårsvurderingen', value: 'MANGELFULL_BEGRUNNELSE' },
    { label: 'Feil resultat i vedtaket', value: 'FEIL_LOVANVENDELSE' },
    { label: 'Annen returårsak', value: 'ANNET' },
  ];

  const vurderingErIkkeGodkjent = form.watch(`totrinnsvurderinger.${index}.godkjent`) === JaEllerNei.Nei;
  const behovstypeEllerKode =
    Object.keys(Behovstype)[Object.values(Behovstype).indexOf(field.definisjon as Behovstype)] || field.definisjon;
  const eventPrefix = behovstypeEllerKode;
  const skalViseEndretSidenSistInfo =
    endretSidenForrigeGang != null && erKvalitetssikring;

  const visEndretTekst = skalViseEndretSidenSistInfo && endretSidenForrigeGang;
  const visIkkeEndretTekst = skalViseEndretSidenSistInfo && !endretSidenForrigeGang;

  return (
    <div
      className={`${visEndretTekst ? styles.totrinnsvurderingFormMedEndring : styles.totrinnsvurderingFormUtenEndring}`}
    >
      <div className={`${styles.heading} ${visEndretTekst && styles.endretSidenSistHeading}`}>
        <VStack gap={'space-6'}>
          {visEndretTekst && (
            <HStack gap={'space-4'}>
              <PencilWritingIcon className={`${styles.endretSidenSistIkon}`} />
              <Detail data-color={'warning'} textColor={'subtle'}>
                Vurderingen er endret siden forrige retur
              </Detail>
            </HStack>
          )}
          {visIkkeEndretTekst && <Detail>Ingen endring siden forrige retur</Detail>}
          <AkselLink
            as={Link}
            prefetch={false}
            href={link}
            onClick={() => felterOnBlur(`${eventPrefix}_LINK`, Date.now())}
          >
            {mapBehovskodeTilBehovstype(field.definisjon as Behovstype)}
          </AkselLink>
        </VStack>
      </div>
      <div className={styles.felter}>
        <RadioGroupWrapper
          label={'Godkjenner du vilkårsvurderingen?'}
          control={form.control}
          name={`totrinnsvurderinger.${index}.godkjent`}
          readOnly={readOnly}
        >
          {JaEllerNeiOptions.map((option) => (
            <Radio
              onBlur={() => felterOnBlur(`${eventPrefix}_GODKJENT`, Date.now())}
              value={option.value}
              key={option.value}
            >
              {option.label}
            </Radio>
          ))}
        </RadioGroupWrapper>

        {vurderingErIkkeGodkjent && (
          <>
            <TextAreaWrapper
              label={'Begrunnelse for retur'}
              readOnly={readOnly}
              control={form.control}
              name={`totrinnsvurderinger.${index}.begrunnelse`}
              rules={{
                required: 'Du må gi en begrunnelse',
                validate: {
                  ikkeKunWhitespace: (value) =>
                    value && (value as string).trim().length === 0
                      ? 'Begrunnelse kan ikke være tom eller kun inneholde mellomrom'
                      : true,
                },
              }}
              onBlur={() => felterOnBlur(`${eventPrefix}_RETUR_BEGRUNNELSE`, Date.now())}
            />
            <CheckboxWrapper
              label={'Returårsak'}
              readOnly={readOnly}
              control={form.control}
              name={`totrinnsvurderinger.${index}.grunner`}
              rules={{ required: 'Du må oppgi en årsak' }}
            >
              {grunnOptions.map((option) => (
                <Checkbox
                  value={option.value}
                  key={option.value}
                  onBlur={() => felterOnBlur(`${eventPrefix}_RETUR_GRUNNER`, Date.now())}
                >
                  {option.label}
                </Checkbox>
              ))}
            </CheckboxWrapper>
          </>
        )}
      </div>
    </div>
  );
};
