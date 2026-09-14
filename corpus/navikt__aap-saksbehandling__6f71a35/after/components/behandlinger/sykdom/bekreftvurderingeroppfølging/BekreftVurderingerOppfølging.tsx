'use client';

import { Button, ErrorSummary, VStack } from '@navikt/ds-react';
import { useParamsMedType } from 'hooks/saksbehandling/BehandlingHook';
import { useBekreftVurderingerGrunnlag } from 'hooks/saksbehandling/BekrefteVurderingerHook';
import { useLøsBehovOgGåTilNesteSteg } from 'hooks/saksbehandling/LøsBehovOgGåTilNesteStegHook';
import { BekreftVurderingerOppfølgingGrunnlag } from 'lib/types/types';
import { Behovstype, mapBehovskodeTilBehovstype } from 'lib/utils/form';
import { byggVilkårskortLenke } from 'lib/utils/vilkårskort';

import { LøsBehovOgGåTilNesteStegStatusAlert } from 'components/løsbehovoggåtilnestestegstatusalert/LøsBehovOgGåTilNesteStegStatusAlert';
import { VilkårsKort } from 'components/vilkårskort/Vilkårskort';

interface Props {
  behandlingVersjon: number;
  readOnly: boolean;
  initialGrunnlag: BekreftVurderingerOppfølgingGrunnlag;
}

export const BekreftVurderingerOppfølging = ({ behandlingVersjon, readOnly, initialGrunnlag }: Props) => {
  const { behandlingsreferanse, saksnummer } = useParamsMedType();
  const { status, løsBehovOgGåTilNesteSteg, isLoading, løsBehovOgGåTilNesteStegError } = useLøsBehovOgGåTilNesteSteg(
    'BEKREFT_VURDERINGER_OPPFØLGING'
  );

  const { grunnlag } = useBekreftVurderingerGrunnlag(initialGrunnlag);

  return (
    <VilkårsKort heading={'Bekreft vurderinger'} steg={'BEKREFT_VURDERINGER_OPPFØLGING'} aktivMarkering={true}>
      {!readOnly && (
        <VStack gap={'space-16'}>
          {grunnlag?.mellomlagredeVurderinger.length != 0 && (
            <VStack gap={'space-16'}>
              <ErrorSummary
                size={'small'}
                heading={'Det finnes endringer som ikke er lagret. Bekreft eller avbryt disse før du kan fortsette.'}
              >
                {grunnlag?.mellomlagredeVurderinger.map((vurdering) => (
                  <ErrorSummary.Item
                    key={vurdering.avklaringsbehovKode}
                    href={byggVilkårskortLenke(
                      saksnummer,
                      behandlingsreferanse,
                      vurdering.avklaringsbehovKode as Behovstype
                    )}
                  >
                    {mapBehovskodeTilBehovstype(vurdering.avklaringsbehovKode)}
                  </ErrorSummary.Item>
                ))}
              </ErrorSummary>
            </VStack>
          )}

          <Button
            variant={'primary'}
            className="fit-content"
            disabled={grunnlag?.mellomlagredeVurderinger.length != 0}
            onClick={() =>
              løsBehovOgGåTilNesteSteg({
                behandlingVersjon: behandlingVersjon,
                behov: {
                  behovstype: Behovstype.BEKREFT_VURDERINGER_OPPFØLGING,
                },
                referanse: behandlingsreferanse,
              })
            }
            loading={isLoading}
          >
            Bekreft vurderinger og send videre
          </Button>
        </VStack>
      )}
      <LøsBehovOgGåTilNesteStegStatusAlert
        status={status}
        løsBehovOgGåTilNesteStegError={løsBehovOgGåTilNesteStegError}
      />
    </VilkårsKort>
  );
};
