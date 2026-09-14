<?php

namespace Shieldforce\CheckoutPayment\Services\Sicoob\Boleto;

use Carbon\Carbon;
use Endroid\QrCode\QrCode;
use Endroid\QrCode\Writer\PngWriter;
use Exception;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Shieldforce\CheckoutPayment\Enums\StatusCheckoutEnum;
use Shieldforce\CheckoutPayment\Enums\TypeGatewayEnum;
use Shieldforce\CheckoutPayment\Models\CppCheckout;
use Shieldforce\CheckoutPayment\Models\CppGateways;
use Shieldforce\CheckoutPayment\Services\Sicoob\Auth\LoginSicoobService;

class BoletoPixService
{
    public ?string $token = null;

    public CppGateways $firstGatewaySicoob;

    public array $login;

    public function __construct()
    {
        $this->firstGatewaySicoob = CppGateways::where('name', TypeGatewayEnum::sicoob->value)->first();

        // Boleto e Pix Sicoob ---
        $sicoobLogin = new LoginSicoobService;
        $this->login = $sicoobLogin->auth([
            'client_id' => $this->firstGatewaySicoob->field_2,
            'path_certificado' => storage_path($this->firstGatewaySicoob->field_5),
            'senha_certificado' => $this->firstGatewaySicoob->field_1,
        ]);

        $this->token = $this->login['access_token'] ?? null;
    }

    public function insert($dados)
    {
        $payload = [
            'numeroCliente' => (int) $dados['numero_cliente'],
            'codigoModalidade' => 1,
            'numeroContaCorrente' => (int) $dados['numero_conta'],
            'codigoEspecieDocumento' => 'DM',
            'dataEmissao' => date('Y-m-d'),
            'seuNumero' => (string) $dados['external_reference'],
            'identificacaoEmissaoBoleto' => 1,
            'identificacaoDistribuicaoBoleto' => 1,
            'valor' => $dados['value'],
            'dataVencimento' => $dados['due'],
            'dataLimitePagamento' => Carbon::parse($dados['due'])->addDays(60)->format('Y-m-d'),
            'tipoDesconto' => 0,
            'tipoMulta' => 1,
            'dataMulta' => Carbon::parse($dados['due'])->addDays(2)->format('Y-m-d'),
            'valorMulta' => 2,
            'tipoJurosMora' => 1,
            'dataJurosMora' => Carbon::parse($dados['due'])->addDays(3)->format('Y-m-d'),
            'valorJurosMora' => 0.01,
            'numeroParcela' => 1,
            'pagador' => [
                'numeroCpfCnpj' => (string) $dados['pagador']['numeroCpfCnpj'],
                'nome' => $this->limpaNome($dados['pagador']['nome']),
                'endereco' => Str::upper(Str::ascii($dados['pagador']['endereco'])),
                'bairro' => Str::upper(Str::ascii($dados['pagador']['bairro'])),
                'cidade' => Str::upper(Str::ascii($dados['pagador']['cidade'])),
                'cep' => $dados['pagador']['cep'],
                'uf' => Str::upper(Str::ascii($dados['pagador']['uf'])),
                'email' => $dados['pagador']['email'],
            ],
            'beneficiarioFinal' => [
                'numeroCpfCnpj' => (string) $dados['beneficiarioFinal']['numeroCpfCnpj'],
                'nome' => $dados['beneficiarioFinal']['nome'],
            ],
            'mensagensInstrucao' => $dados['mensagensInstrucao'],
            'gerarPdf' => true,
            'codigoCadastrarPIX' => 1,
            'numeroContratoCobranca' => $dados['numeroContratoCobranca'],
        ];

        $curl = curl_init();

        curl_setopt_array($curl, [
            CURLOPT_URL => 'https://api.sicoob.com.br/cobranca-bancaria/v3/boletos',
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Accept: application/json',
                'Authorization: Bearer ' . $this->token,
                'client_id: ' . $dados['client_id'],
            ],

            // 🔐 Certificado
            CURLOPT_SSLCERTTYPE => 'P12',
            CURLOPT_SSLCERT => $dados['path_certificado'],
            CURLOPT_SSLCERTPASSWD => $dados['senha_certificado'],

            // SSL
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,

            // Debug opcional
            CURLOPT_VERBOSE => true,
        ]);

        $response = curl_exec($curl);

        if ($response === false) {
            throw new Exception('Erro cURL: ' . curl_error($curl));
        }

        curl_close($curl);

        return json_decode($response, true) ?? false;
    }

    public function consult($checkout = null)
    {

        if (! isset($checkout->id)) {
            throw new Exception('Checkout não existe!');
        }

        $firstGatewaySicoob = $this->firstGatewaySicoob;

        if (! isset($firstGatewaySicoob->id)) {
            throw new Exception('Gateway sicoob não existe!');
        }

        $step4 = $checkout?->step4?->first();

        if (! $step4) {
            throw new Exception('Nenhum boleto ou pix foi gerado para este checkout ainda.');
        }

        $responsePixSicoob = isset(json_decode($step4->response_pix_data ?? 'null', true)['nossoNumero'])
            ? json_decode($step4->response_pix_data, true)
            : null;

        $responseBilletSicoob = isset(json_decode($step4->response_billet_data ?? 'null', true)['nossoNumero'])
            ? json_decode($step4->response_billet_data, true)
            : null;

        $nossoNumero = $responsePixSicoob['nossoNumero'] ?? $responseBilletSicoob['nossoNumero'] ?? null;

        return $this->consultByNossoNumero($nossoNumero);
    }

    /**
     * Consulta um boleto/pix específico do Sicoob pelo nosso número, sem depender
     * do step4 (que só guarda o último gerado) — usado pra checar ao vivo o status
     * de qualquer tentativa já registrada no histórico.
     */
    public function consultByNossoNumero(?string $nossoNumero)
    {
        if (! $nossoNumero) {
            throw new Exception('Nosso Número não informado!');
        }

        $firstGatewaySicoob = $this->firstGatewaySicoob;

        if (! isset($firstGatewaySicoob->id)) {
            throw new Exception('Gateway sicoob não existe!');
        }

        $payload = [
            'client_id' => $firstGatewaySicoob->field_2 ?? null,
            'path_certificado' => storage_path($firstGatewaySicoob->field_5 ?? ''),
            'senha_certificado' => $firstGatewaySicoob->field_1 ?? null,
            'numero_cliente' => $firstGatewaySicoob->field_4 ?? null,
            'nosso_numero' => $nossoNumero,
            'numero_contrato' => $firstGatewaySicoob->field_3 ?? null,
        ];

        $link = 'https://api.sicoob.com.br/cobranca-bancaria/v3/boletos';
        $link .= "?numeroCliente={$payload['numero_cliente']}";
        $link .= "&codigoModalidade=1&nossoNumero={$payload['nosso_numero']}";
        $link .= "&numeroContratoCobranca={$payload['numero_contrato']}";
        $curl = curl_init();

        curl_setopt_array($curl, [
            CURLOPT_URL => $link,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => 'GET',

            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'Authorization: Bearer ' . $this->token,
                'client_id: ' . $payload['client_id'],
            ],

            CURLOPT_SSLCERTTYPE => 'P12',
            CURLOPT_SSLCERT => $payload['path_certificado'],
            CURLOPT_SSLCERTPASSWD => $payload['senha_certificado'],

            // SSL
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);

        $response = curl_exec($curl);

        if ($response === false) {
            throw new Exception('Erro cURL: ' . curl_error($curl));
        }

        curl_close($curl);

        return json_decode($response, true) ?? false;
    }

    public function update($nossoNumero, $dados)
    {
        $payload = [
            'numeroCliente' => $dados['numero_cliente'],
            'codigoModalidade' => 1,
            'numeroContaCorrente' => $dados['numero_conta'],
            'codigoEspecieDocumento' => 'DM',
            'dataEmissao' => date('Y-m-d'),
            'seuNumero' => $dados['external_reference'],
            'identificacaoEmissaoBoleto' => 1,
            'identificacaoDistribuicaoBoleto' => 1,
            'valor' => $dados['value'],
            'dataVencimento' => $dados['due'],
            'dataLimitePagamento' => Carbon::parse($dados['due'])->addDays(60)->format('Y-m-d'),
            'tipoDesconto' => 0,
            'tipoMulta' => 1,
            'dataMulta' => Carbon::parse($dados['due'])->addDays(2)->format('Y-m-d'),
            'valorMulta' => 2,
            'tipoJurosMora' => 1,
            'dataJurosMora' => Carbon::parse($dados['due'])->addDays(3)->format('Y-m-d'),
            'valorJurosMora' => 0.01,
            'numeroParcela' => 1,
            'pagador' => [
                'numeroCpfCnpj' => $dados['pagador']['numeroCpfCnpj'],
                'nome' => $dados['pagador']['nome'],
                'endereco' => $dados['pagador']['endereco'],
                'bairro' => $dados['pagador']['bairro'],
                'cidade' => $dados['pagador']['cidade'],
                'cep' => $dados['pagador']['cep'],
                'uf' => $dados['pagador']['uf'],
                'email' => $dados['pagador']['email'],
            ],
            'beneficiarioFinal' => [
                'numeroCpfCnpj' => $dados['empresaCnpj'],
                'nome' => $dados['empresa'],
            ],
            'mensagensInstrucao' => $dados['mensagensInstrucao'],
            'gerarPdf' => true,
            'codigoCadastrarPIX' => 1,
            'numeroContratoCobranca' => $dados['numero_contrato'],
        ];

        $curl = curl_init();

        curl_setopt_array($curl, [
            CURLOPT_URL => "https://api.sicoob.com.br/cobranca-bancaria/v3/boletos/{$nossoNumero}",
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Accept: application/json',
                'Authorization: Bearer ' . $this->token,
                'client_id: ' . $dados['client_id'],
            ],

            // 🔐 Certificado
            CURLOPT_SSLCERTTYPE => 'P12',
            CURLOPT_SSLCERT => $dados['path_certificado'],
            CURLOPT_SSLCERTPASSWD => $dados['senha_certificado'],

            // SSL
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,

            // Debug opcional
            // CURLOPT_VERBOSE => true,
        ]);

        $response = curl_exec($curl);

        if ($response === false) {
            throw new Exception('Erro cURL: ' . curl_error($curl));
        }

        curl_close($curl);

        return json_decode($response, true) ?? false;
    }

    public function baixa($checkout = null)
    {
        if (! isset($checkout->id)) {
            return false;
        }

        $firstGatewaySicoob = $this->firstGatewaySicoob;

        if (! isset($firstGatewaySicoob->id)) {
            throw new Exception('Gateway sicoob não existe!');
        }

        $step4 = $checkout?->step4?->first();

        if (! $step4) {
            throw new Exception('Nenhum boleto ou pix foi gerado para este checkout ainda.');
        }

        $responsePixSicoob = isset(json_decode($step4->response_pix_data ?? 'null', true)['nossoNumero'])
            ? json_decode($step4->response_pix_data, true)
            : null;

        $responseBilletSicoob = isset(json_decode($step4->response_billet_data ?? 'null', true)['nossoNumero'])
            ? json_decode($step4->response_billet_data, true)
            : null;

        $nossoNumero = $responsePixSicoob['nossoNumero'] ?? $responseBilletSicoob['nossoNumero'] ?? null;

        if (! $nossoNumero) {
            throw new Exception('Nosso Número não encontrado para este checkout!');
        }

        $payload = [
            'numeroCliente' => $firstGatewaySicoob->field_4 ?? null,
            'codigoModalidade' => 1,
        ];

        $curl = curl_init();

        curl_setopt_array($curl, [
            CURLOPT_URL => "https://api.sicoob.com.br/cobranca-bancaria/v3/boletos/{$nossoNumero}/baixar",
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload),

            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Accept: application/json',
                'Authorization: Bearer ' . $this->token,
                'client_id: ' . $firstGatewaySicoob->field_2,
            ],

            CURLOPT_SSLCERTTYPE => 'P12',
            CURLOPT_SSLCERT => storage_path($firstGatewaySicoob->field_5 ?? ''),
            CURLOPT_SSLCERTPASSWD => $firstGatewaySicoob->field_1,

            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);

        $response = curl_exec($curl);

        if ($response === false) {
            throw new Exception('Erro cURL: ' . curl_error($curl));
        }

        curl_close($curl);

        return json_decode($response, true) ?? false;
    }

    private function limpaNome($valor, $limite = 40)
    {
        $valor = mb_convert_encoding($valor, 'UTF-8', 'auto');
        $valor = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $valor);
        $valor = preg_replace('/[^A-Za-z0-9 ]/', '', $valor);
        $valor = preg_replace('/\s+/', ' ', $valor);
        $valor = trim($valor);

        return substr($valor, 0, $limite);
    }

    public function boletoPixInserir($checkout = null)
    {
        if (! isset($checkout->id)) {
            throw new Exception('Checkout não existe!');
        }

        $firstGatewaySicoob = $this->firstGatewaySicoob;
        $transaction = $checkout?->referencable;

        if (! isset($firstGatewaySicoob->id)) {
            throw new Exception('Gateway sicoob não existe!');
        }

        if (
            isset($transaction->due_date) &&
            $transaction->due_date <= Carbon::today()->format('Y-m-d H:i:s')
        ) {
            $dias_atraso = Carbon::parse($transaction->due_date)->diffInDays(Carbon::today());
            if ($dias_atraso > 5) {
                $texto1 = 'Vencido a ' . $dias_atraso . ' dias.';
                $texto2 = 'Valor atualizado';
            }
        }

        if (
            $transaction?->order?->sicoob &&
            isset($firstGatewaySicoob->id) &&
            isset($transaction->id)
        ) {

            $order = $transaction?->order;
            $client = $order->client;
            $address = $client->addresses->first();

            $dueDate = Carbon::parse($transaction->due_date)
                ->format('Y-m-d');

            $value = number_format($transaction->value, 2, '.', '');

            $payload = [
                // config ---
                'client_id' => $firstGatewaySicoob->field_2,
                'path_certificado' => storage_path($firstGatewaySicoob->field_5),
                'senha_certificado' => $firstGatewaySicoob->field_1,
                'numero_cliente' => $firstGatewaySicoob->field_4,
                'numero_conta' => $firstGatewaySicoob->field_6,
                'numeroContratoCobranca' => $firstGatewaySicoob->field_3,
                // ---
                'external_reference' => $checkout->uuid,
                'value' => $value,
                'due' => $dueDate,
                'pagador' => [
                    'numeroCpfCnpj' => $client->document,
                    'nome' => $client->name,
                    'endereco' => $address->street . ' ' . $address->number,
                    'bairro' => $address->district,
                    'cidade' => $address->city,
                    'cep' => $address->zipcode,
                    'uf' => $address->state,
                    'email' => $client->email,
                ],
                'beneficiarioFinal' => [
                    'numeroCpfCnpj' => '11655954000159',
                    'nome' => 'Federal Telecom',
                ],
                'mensagensInstrucao' => [
                    $texto1 ?? 'Mensalidade Federal Associados',
                    $texto2 ?? 'Multa de 2%, e 0,1% ao dia',
                    'Dúvidas? Ligue 08008882629',
                    'Juntos Somos Fortes',
                ],
            ];

            return [
                'inserir' => $this->insert($payload),
                'payload' => $payload,
            ];
        }

        return false;
    }

    public function salvarDadosBoletoPix(CppCheckout $checkout, $resultado)
    {
        $pdf = null;
        $qrcodeBase64 = null;

        $inserir = $resultado['inserir']['resultado'];
        $payload = $resultado['payload'];

        if (! empty($inserir['pdfBoleto'])) {
            $pdfContent = base64_decode($inserir['pdfBoleto']);
            $path = 'boletos/' . ($inserir['nossoNumero'] ?? uniqid()) . '.pdf';
            Storage::disk('public')->put($path, $pdfContent);
            $pdf = url(Storage::disk('public')->url($path));
        }

        if (! empty($inserir['qrCode'])) {

            $qrCode = new QrCode(
                data: trim($inserir['qrCode'])
            );

            $writer = new PngWriter;

            $result = $writer->write($qrCode);

            $qrcodeBase64 = base64_encode(
                $result->getString()
            );

            // Teste:
            // dd(substr($qrcodeBase64, 0, 30));
            // Deve começar com: iVBORw0KGgo...
        }

        $checkout->step4()->updateOrCreate(
            [
                'cpp_checkout_id' => $checkout->id,
            ],
            [
                'base_qrcode' => $qrcodeBase64 ?? null,
                'url_qrcode' => $inserir['qrCode'] ?? null,
                'request_pix_data' => json_encode($payload),
                'response_pix_data' => json_encode($inserir),
                'payment_method_id' => 'bolsicoob',
                'url_billet' => $pdf,
                'request_billet_data' => json_encode($payload),
                'response_billet_data' => json_encode($inserir),
            ]
        );

        // Cada geração vira uma linha nova aqui (diferente do step4, que é sobrescrito)
        // pra manter o histórico completo de boletos/pix já emitidos por esse checkout.
        $checkout->sicoobAttempts()->create([
            'nosso_numero' => $inserir['nossoNumero'] ?? null,
            'payment_method_id' => 'bolsicoob',
            'value' => $payload['value'] ?? null,
            'due_date' => $payload['due'] ?? null,
            'url_billet' => $pdf,
            'url_qrcode' => $inserir['qrCode'] ?? null,
            'request_data' => json_encode($payload),
            'response_data' => json_encode($inserir),
        ]);

        $checkout->update([
            'status' => StatusCheckoutEnum::pendente->value,
            'startOnStep' => 5,
            'cpp_gateway_id' => $this->firstGatewaySicoob->id,
        ]);

        return $checkout;
    }
}
