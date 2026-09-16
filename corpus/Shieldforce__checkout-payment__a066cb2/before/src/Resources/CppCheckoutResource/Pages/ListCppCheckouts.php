<?php

namespace Shieldforce\CheckoutPayment\Resources\CppCheckoutResource\Pages;

use App\Jobs\GenerateMonthlyBillingsJob;
use Filament\Actions;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\ListRecords;
use Illuminate\Support\Carbon;
use Shieldforce\CheckoutPayment\Enums\MethodPaymentEnum;
use Shieldforce\CheckoutPayment\Enums\StatusCheckoutEnum;
use Shieldforce\CheckoutPayment\Enums\TypeGatewayEnum;
use Shieldforce\CheckoutPayment\Enums\TypeStepEnum;
use Shieldforce\CheckoutPayment\Models\CppCheckout;
use Shieldforce\CheckoutPayment\Pages\DashboardMercadoPago;
use Shieldforce\CheckoutPayment\Resources\CppCheckoutResource;
use Shieldforce\CheckoutPayment\Services\MercadoPago\MercadoPagoService;
use Shieldforce\CheckoutPayment\Services\MercadoPago\MPCreateLocalService;
use Shieldforce\CheckoutPayment\Services\Sicoob\Boleto\BoletoPixService;

class ListCppCheckouts extends ListRecords
{
    protected static string $resource = CppCheckoutResource::class;

    protected function getHeaderActions(): array
    {
        return [

            Actions\Action::make('dashboard_mp')
                ->label('Dashboard MP')
                ->icon('heroicon-o-chart-bar')
                ->color('success')
                ->url(fn () => DashboardMercadoPago::getUrl())
            /* ->openUrlInNewTab() */,

            Actions\Action::make('runMonthlyBilling')
                ->label('Rodar Faturamento Mensal')
                ->icon('heroicon-o-play')
                ->color('success')

                // 👉 FORM DO MODAL
                ->form([
                    TextInput::make('reference')
                        ->label('Referência - Exp: 12/2025')
                        ->helperText('Ex: 01/2026')
                        ->default(now()->subMonth()->format('m/Y'))
                        ->required(),

                    Select::make('billingDay')
                        ->label('Dia de Cobrança')
                        ->required()
                        ->options(function (callable $get) {
                            $reference = $get('reference');

                            try {
                                [
                                    $month,
                                    $year
                                ] = explode('/', $reference);
                                $daysInMonth = Carbon::createFromDate($year, $month, 1)->daysInMonth;
                            } catch (\Throwable) {
                                $daysInMonth = now()->daysInMonth;
                            }

                            $days = collect(range(1, $daysInMonth))
                                ->mapWithKeys(fn ($day) => [
                                    str_pad($day, 2, '0', STR_PAD_LEFT) => str_pad($day, 2, '0', STR_PAD_LEFT),
                                ])
                                ->toArray();

                            // adiciona "Todos os dias" no topo
                            return ['all' => 'Todos os dias'] + $days;
                        })
                        ->default(fn () => str_pad(now()->day, 2, '0', STR_PAD_LEFT)),
                ])
                ->modalHeading('Gerar cobranças mensais')
                ->modalDescription(
                    'Informe a referência e o dia de cobrança para gerar as cobranças manualmente.'
                )
                ->modalSubmitActionLabel('Executar faturamento')

                // 👉 AÇÃO FINAL
                ->action(function (array $data) {

                    GenerateMonthlyBillingsJob::dispatch(
                        $data['reference'],
                        $data['billingDay'],
                    );

                    Notification::make()
                        ->title('Faturamento iniciado')
                        ->body("Referência {$data['reference']} • Dia {$data['billingDay']}")
                        ->success()
                        ->send();
                }),
        ];
    }

    public function atualizarPagamento($paymentId, $method, $recordId)
    {
        dd($paymentId, $method, $recordId);
    }

    public function tentarNovamente($recordId): void
    {
        $checkout = CppCheckout::find($recordId);

        if (! $checkout) {
            Notification::make()
                ->danger()
                ->title('Erro ao tentar novamente')
                ->body('Checkout não encontrado.')
                ->send();

            return;
        }

        try {
            if ($checkout->gateway?->name === TypeGatewayEnum::sicoob->value) {
                $this->tentarNovamenteSicoob($checkout);

                return;
            }

            $this->tentarNovamenteMercadoPago($checkout);
        } catch (\Throwable $e) {
            Notification::make()
                ->danger()
                ->title('Erro ao tentar novamente')
                ->body($e->getMessage())
                ->send();
        }
    }

    private function tentarNovamenteMercadoPago(CppCheckout $checkout): void
    {
        if ((int) $checkout->method_checked === MethodPaymentEnum::credit_card->value) {
            Notification::make()
                ->warning()
                ->title('Não é possível tentar novamente por aqui')
                ->body('Pagamento no cartão precisa ser refeito pelo cliente na tela de checkout.')
                ->send();

            return;
        }

        $mpCreate = new MPCreateLocalService($checkout, origin: 'manual');

        $return = match ((int) $checkout->method_checked) {
            MethodPaymentEnum::pix->value => $mpCreate->pix(),
            MethodPaymentEnum::billet->value => $mpCreate->boleto(),
            default => null,
        };

        if ($return === null) {
            Notification::make()
                ->warning()
                ->title('Método de pagamento não identificado para este checkout.')
                ->send();

            return;
        }

        if (isset($return['error'])) {
            Notification::make()
                ->danger()
                ->title('Falha ao gerar novamente')
                ->body($return['message'] ?? 'Erro desconhecido.')
                ->send();

            return;
        }

        Notification::make()
            ->success()
            ->title('Gerado com sucesso!')
            ->body('Atualize a página para ver o novo boleto/pix.')
            ->send();
    }

    private function tentarNovamenteSicoob(CppCheckout $checkout): void
    {
        $boletoPixSicoob = new BoletoPixService;
        $inserir = $boletoPixSicoob->boletoPixInserir($checkout);

        if (isset($inserir['inserir']['resultado'])) {
            $boletoPixSicoob->salvarDadosBoletoPix($checkout, $inserir);

            Notification::make()
                ->success()
                ->title('Gerado com sucesso!')
                ->body('Atualize a página para ver o novo boleto/pix.')
                ->send();

            return;
        }

        $msg = $inserir['inserir']['mensagens'][0]['mensagem'] ?? 'Erro desconhecido.';

        Notification::make()
            ->danger()
            ->title('Falha ao gerar novamente')
            ->body($msg)
            ->send();
    }

    public function consultarBoleto($nossoNumero, $recordId): void
    {
        $checkout = CppCheckout::find($recordId);

        if (! $checkout) {
            Notification::make()
                ->danger()
                ->title('Erro ao atualizar status')
                ->body('Checkout não encontrado.')
                ->send();

            return;
        }

        try {
            $sicoob = new BoletoPixService;
            $consultar = $sicoob->consult($checkout);
            $status = $consultar['resultado']['situacaoBoleto'] ?? null;

            match ($status) {
                'Liquidado' => $checkout->update([
                    'startOnStep' => TypeStepEnum::finalizado->value,
                    'status' => StatusCheckoutEnum::finalizado->value,
                ]),
                'Baixado' => $checkout->update([
                    'startOnStep' => TypeStepEnum::finalizado->value,
                    'status' => StatusCheckoutEnum::baixado->value,
                ]),
                'Em Aberto' => $checkout->update([
                    'startOnStep' => TypeStepEnum::finalizado->value,
                    'status' => StatusCheckoutEnum::pendente->value,
                ]),
                default => null,
            };

            Notification::make()
                ->success()
                ->title('Status consultado!')
                ->body("Pagamento #{$nossoNumero}: " . ($status ?? 'status desconhecido'))
                ->send();
        } catch (\Throwable $e) {
            Notification::make()
                ->danger()
                ->title('Erro ao atualizar status')
                ->body($e->getMessage())
                ->send();
        }
    }

    public function cancelarBoleto($nossoNumero, $recordId): void
    {
        $checkout = CppCheckout::find($recordId);

        if (! $checkout) {
            Notification::make()
                ->danger()
                ->title('Erro ao cancelar boleto')
                ->body('Checkout não encontrado.')
                ->send();

            return;
        }

        try {
            $sicoob = new BoletoPixService;
            $baixa = $sicoob->baixa($checkout);

            if (! $baixa || isset($baixa['mensagens'])) {
                Notification::make()
                    ->danger()
                    ->title('Erro ao cancelar boleto')
                    ->body($baixa['mensagens'][0]['mensagem'] ?? 'Não foi possível cancelar o boleto.')
                    ->send();

                return;
            }

            $checkout->update([
                'startOnStep' => TypeStepEnum::finalizado->value,
                'status' => StatusCheckoutEnum::baixado->value,
            ]);

            Notification::make()
                ->success()
                ->title('Pagamento cancelado!')
                ->body("Pagamento #{$nossoNumero} cancelado com sucesso.")
                ->send();
        } catch (\Throwable $e) {
            Notification::make()
                ->danger()
                ->title('Erro ao cancelar boleto')
                ->body($e->getMessage())
                ->send();
        }
    }

    public function cancelarPagamentoMp($paymentId, $recordId): void
    {
        $mps = new MercadoPagoService;

        $cancel = $mps->cancelarPagamento($paymentId);

        logger([
            'payment_id' => $paymentId,
            'cancel' => $cancel,
        ]);

        if ($cancel['success']) {

            $checkout = CppCheckout::find($recordId);

            $checkout->update([
                'status' => StatusCheckoutEnum::cancelado->value,
                'startOnStep' => 5,
            ]);

            $step4 = $checkout->step4->first();

            $step4->update([
                'card_number' => null,
                'card_token' => null,
                'installments' => null,
                'payment_method_id' => null,
                'card_validate' => null,
                'card_payer_name' => null,
                'base_qrcode' => null,
                'url_qrcode' => null,
                'url_billet' => null,
                'request_credit_card_data' => null,
                'response_credit_card_data' => null,
                'request_pix_data' => null,
                'response_pix_data' => null,
                'request_billet_data' => json_encode([]),
                'response_billet_data' => json_encode([]),
            ]);

            Notification::make()
                ->success()
                ->title('Pagamento cancelado!')
                ->body("Pagamento #{$paymentId} cancelado com sucesso.")
                ->send();

        } else {

            Notification::make()
                ->danger()
                ->title('Erro ao cancelar!')
                ->body($cancel['message'] ?? 'Erro desconhecido.')
                ->send();
        }
    }
}
