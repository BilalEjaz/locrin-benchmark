{{-- Author: MEMORA solutions, https://memora.solutions ; info@memora.ca --}}
@extends(fronttheme_layout())

@section('title', __('Politique de confidentialité') . ' - ' . config('app.name'))
@section('meta_description', __('Politique de confidentialité de laveille.ai : RGPD, Loi 25, LPRPDE.'))

@section('breadcrumb')
    @include('fronttheme::partials.breadcrumb', ['breadcrumbTitle' => __('Politique de confidentialité')])
@endsection

@section('content')
@php
    $locale = app()->getLocale();
    $company = config('privacy.company');
    $doc = config('privacy.documents.privacy_policy');
    $categories = config('privacy.categories');
    $rights = config('privacy.rights');
    $jurisdictions = config('privacy.jurisdictions');
    $rightsLabels = [
        'access' => __('Droit d\'accès'),
        'rectification' => __('Droit de rectification'),
        'erasure' => __('Droit à l\'effacement'),
        'portability' => __('Droit à la portabilité'),
        'opposition' => __('Droit d\'opposition'),
        'limitation' => __('Droit à la limitation du traitement'),
        'withdrawal' => __('Droit de retrait du consentement'),
    ];
@endphp
<section class="wpo-blog-single-section section-padding">
    <div class="container">
        <div class="row">
            <div class="col col-lg-10 offset-lg-1">
                <div class="wpo-blog-content">
                    <div class="post">
                        <h2>{{ __('Politique de confidentialité') }}</h2>
                        <p style="color: #999; font-size: 13px;">
                            <strong>{{ __('Version') }}&nbsp;:</strong> {{ $doc['version'] }}<br>
                            <strong>{{ __('Dernière mise à jour') }}&nbsp;:</strong> {{ \Carbon\Carbon::parse($doc['updated_at'])->translatedFormat('d F Y') }}
                        </p>

                        <div class="entry-details" style="line-height: 1.8;">
                            <div style="background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">
                                <h4 style="margin-top: 0;">{{ __('Table des matières') }}</h4>
                                <ol>
                                    <li><a href="#introduction">{{ __('Introduction et lois applicables') }}</a></li>
                                    <li><a href="#controller">{{ __('Responsable du traitement') }}</a></li>
                                    <li><a href="#data-collected">{{ __('Données personnelles collectées') }}</a></li>
                                    <li><a href="#outils-locaux">{{ __('Outils interactifs : traitement local (côté client)') }}</a></li>
                                    <li><a href="#legal-bases">{{ __('Fondements juridiques') }}</a></li>
                                    <li><a href="#purposes">{{ __('Finalités du traitement') }}</a></li>
                                    <li><a href="#contributions">{{ __('Contributions des membres') }}</a></li>
                                    <li><a href="#ia">{{ __('Résumés par intelligence artificielle') }}</a></li>
                                    <li><a href="#shorturl">{{ __('Raccourcisseur d\'URL (veille.la)') }}</a></li>
                                    <li><a href="#rss">{{ __('Agrégation RSS et contenu tiers') }}</a></li>
                                    <li><a href="#newsletter">{{ __('Infolettre') }}</a></li>
                                    <li><a href="#cookies">{{ __('Cookies et traceurs') }}</a></li>
                                    <li><a href="#bases">{{ __('Base juridique par traitement (RGPD art. 6)') }}</a></li>
                                    <li><a href="#sharing">{{ __('Prestataires et transferts internationaux') }}</a></li>
                                    <li><a href="#retention">{{ __('Durée de conservation') }}</a></li>
                                    <li><a href="#breach">{{ __('Notification de brèche') }}</a></li>
                                    <li><a href="#rights">{{ __('Vos droits') }}</a></li>
                                    <li><a href="#eu">{{ __('Dispositions spécifiques visiteurs européens') }}</a></li>
                                    <li><a href="#lia">{{ __('Intérêt légitime') }}</a></li>
                                    <li><a href="#security">{{ __('Mesures de sécurité') }}</a></li>
                                    <li><a href="#efvp">{{ __('Évaluation des facteurs relatifs à la vie privée (EFVP)') }}</a></li>
                                    <li><a href="#minors">{{ __('Mineurs') }}</a></li>
                                    <li><a href="#contact">{{ __('Contact, DPO et autorités') }}</a></li>
                                </ol>
                            </div>

                            <h3 id="introduction">{{ __('1. Introduction et lois applicables') }}</h3>
                            <p>{{ __('Cette politique explique la façon dont nous collectons, utilisons et protégeons vos données personnelles, conformément aux lois suivantes :') }}</p>
                            <ul>
                                <li>{{ __('RGPD : Règlement (UE) 2016/679 (Règlement général sur la protection des données)') }}</li>
                                <li>{{ __('Loi 25 : Loi modernisant des dispositions législatives en matière de protection des renseignements personnels (2021, c. 25, Québec)') }}</li>
                                <li>{{ __('LPRPDE / PIPEDA : Loi sur la protection des renseignements personnels et les documents électroniques (L.C. 2000, ch. 5)') }}</li>
                                <li>{{ __('Directive ePrivacy : Directive 2002/58/CE (protection de la vie privée dans le secteur des communications électroniques)') }}</li>
                            </ul>

                            <h3 id="controller">{{ __('2. Responsable du traitement') }}</h3>
                            <p>
                                <strong>{{ $company['name'] }}</strong>{{ !empty($company['legal_name']) ? ', '.__('dénomination commerciale de').' '.$company['legal_name'] : '' }} ({{ __('NEQ') }}&nbsp;{{ $company['neq'] }})<br>
                                @if(!empty($company['brand']))
                                    {{ __('Exploitant de la plateforme') }} {{ $company['brand'] }} (laveille.ai)<br>
                                @endif
                                {{ $company['address'] }}<br>
                                {{ __('Délégué à la protection des données (DPO)') }}&nbsp;: {{ $company['dpo_name'] }}<br>
                                {{ __('Courriel') }}&nbsp;: <a href="mailto:{{ $company['dpo_email'] }}">{{ $company['dpo_email'] }}</a>
                            </p>

                            <h3 id="data-collected">{{ __('3. Données personnelles collectées') }}</h3>
                            <ul>
                                <li>{{ __('Données d\'identité (nom, prénom, courriel)') }}</li>
                                <li>{{ __('Données de connexion (adresse IP, identifiants de session)') }}</li>
                                <li>{{ __('Données de navigation (pages consultées, préférences)') }}</li>
                                <li>{{ __('Données de consentement et choix de cookies') }}</li>
                            </ul>

                            <h3 id="outils-locaux">{{ __('3b. Outils interactifs : traitement local (côté client)') }}</h3>
                            <p>{{ __('Certains outils interactifs de la plateforme, notamment l\'anonymiseur de texte, les calculatrices et les générateurs, fonctionnent entièrement dans votre navigateur (traitement « côté client »). Les données que vous y saisissez (texte, valeurs, règles) sont traitées localement sur votre appareil : elles ne sont ni transmises, ni consultées, ni conservées sur les serveurs de l\'exploitant. L\'exploitant ne collecte donc aucun de ces renseignements et n\'en assume pas la conservation.') }}</p>
                            <p>{{ __('Lorsqu\'un outil enregistre des données pour votre commodité (par exemple vos règles d\'anonymisation ou un brouillon de texte), celles-ci demeurent uniquement dans le stockage de votre navigateur (localStorage ou sessionStorage), sous votre seul contrôle. Vous pouvez les effacer à tout moment au moyen des fonctions « Effacer » ou « Tout réinitialiser » de l\'outil, ou en vidant les données de votre navigateur ; le brouillon de texte est de toute façon effacé à la fermeture de l\'onglet. Les fichiers que vous exportez sont gérés par vous seul(e). Sur un appareil partagé, pensez à effacer vos données après usage.') }}</p>

                            <h3 id="legal-bases">{{ __('4. Fondements juridiques') }}</h3>
                            <ul>
                                <li><strong>{{ __('Consentement') }}</strong>&nbsp;: {{ __('pour les cookies non essentiels et le marketing') }}</li>
                                <li><strong>{{ __('Exécution de contrat') }}</strong>&nbsp;: {{ __('pour la gestion de votre compte et la fourniture du service') }}</li>
                                <li><strong>{{ __('Intérêt légitime') }}</strong>&nbsp;: {{ __('pour la sécurité et l\'amélioration du service') }}</li>
                                <li><strong>{{ __('Obligation légale') }}</strong>&nbsp;: {{ __('pour la conservation requise par la loi') }}</li>
                            </ul>

                            <h3 id="purposes">{{ __('5. Finalités du traitement') }}</h3>
                            <ul>
                                <li>{{ __('Gestion des comptes et fourniture du service') }}</li>
                                <li>{{ __('Sécurité et prévention de la fraude') }}</li>
                                <li>{{ __('Analyses statistiques et amélioration du service') }}</li>
                                <li>{{ __('Personnalisation de l\'expérience utilisateur') }}</li>
                                <li>{{ __('Respect des obligations légales et réglementaires') }}</li>
                            </ul>

                            <h3 id="contributions">{{ __('6. Contributions des membres') }}</h3>
                            <p>{{ __('Lorsque vous participez à l\'amélioration de notre plateforme via les suggestions, les votes sur les fonctionnalités, le partage d\'idées pour notre feuille de route ou le signalement de bogues, nous collectons les informations que vous choisissez de nous transmettre. Ces données incluent votre identifiant d\'utilisateur, le contenu de votre message et les métadonnées de soumission.') }}</p>
                            <p>{{ __('La base juridique de ce traitement repose sur votre consentement lors de l\'envoi de la contribution, ainsi que sur notre intérêt légitime à améliorer l\'expérience utilisateur et la performance technique de nos services.') }}</p>
                            <p>{{ __('Le constructeur de prompts permet aux utilisateurs connectes de sauvegarder leurs prompts IA dans leur compte. Les donnees stockees incluent le titre, le texte du prompt et les parametres du generateur (persona, verbe, audience, options). Ces donnees sont associees a votre identifiant utilisateur et ne sont pas partagees avec des tiers. Elles ne sont pas utilisees pour l\'entrainement de modeles d\'IA. Vous pouvez supprimer vos prompts sauvegardes a tout moment depuis votre espace « Mes contributions » ou via une demande d\'exercice de vos droits.') }}</p>

                            <h3 id="ia">{{ __('7. Résumés par intelligence artificielle') }}</h3>
                            <p>{{ __('La plateforme utilise des technologies d\'intelligence artificielle pour générer des résumés de contenus de veille. Nous appliquons une politique stricte de protection de la vie privée : aucune donnée personnelle identifiable n\'est transmise aux modèles d\'IA lors de ces traitements automatisés.') }}</p>
                            <p>{{ __('Les contenus générés par IA sont clairement identifiés comme tels dans l\'interface. Conformément à la Loi 25 (art. 12.1), vous disposez d\'un droit d\'opposition au traitement automatisé et pouvez demander des précisions sur les paramètres ayant mené à la génération d\'un contenu spécifique vous concernant, le cas échéant.') }}</p>

                            <h3 id="shorturl">{{ __('8. Raccourcisseur d\'URL (veille.la)') }}</h3>
                            <p>{{ __('Dans le cadre de la diffusion de la veille, nous utilisons le service de raccourcissement d\'URL veille.la. Lorsqu\'un utilisateur clique sur un lien raccourci, nous collectons les données techniques suivantes :') }}</p>
                            <ul>
                                <li>{{ __('L\'adresse IP (anonymisée pour les statistiques)') }}</li>
                                <li>{{ __('L\'agent utilisateur (type de navigateur et système d\'exploitation)') }}</li>
                                <li>{{ __('Le référent (la page de provenance du clic)') }}</li>
                                <li>{{ __('L\'horodatage précis du clic') }}</li>
                            </ul>
                            <p>{{ __('Ces données sont traitées exclusivement à des fins de statistiques d\'utilisation et de mesure d\'audience. Elles sont conservées pour une durée maximale de 12 mois avant d\'être supprimées ou anonymisées de manière irréversible.') }}</p>

                            <h3 id="rss">{{ __('9. Agrégation RSS et contenu tiers') }}</h3>
                            <p>{{ __('Notre service agrège des flux RSS provenant de diverses sources publiques. Ce processus est automatisé et ne collecte aucune donnée personnelle auprès des éditeurs tiers ou des utilisateurs lors de la simple synchronisation des flux. Nous respectons l\'attribution de la source originale pour chaque contenu affiché.') }}</p>
                            <p>{{ __('La responsabilité de laveille.ai est limitée à son propre contenu éditorial. Nous ne pouvons être tenus responsables des pratiques de confidentialité ou du contenu des sites tiers vers lesquels les flux RSS pointent.') }}</p>

                            <h3 id="newsletter">{{ __('10. Infolettre') }}</h3>
                            <p>{{ __('Pour l\'envoi de nos actualités et alertes de veille, nous collectons votre adresse courriel et, de manière optionnelle, votre prénom. Ce service est géré via le prestataire tiers Brevo, dont les serveurs assurent la sécurité des envois.') }}</p>
                            <p>{{ __('Ce traitement est effectué conformément à la Loi canadienne anti-pourriel (LCAP, L.C. 2010, ch. 23) et repose sur votre consentement exprès. Vous pouvez vous désinscrire à tout moment via le lien de désabonnement présent dans chaque envoi. Vos données sont conservées tant que vous demeurez abonné, puis archivées pour une période de 3 ans après votre désinscription à des fins de preuve de conformité, avant suppression définitive.') }}</p>

                            <h3 id="transactional">{{ __('10b. Communications transactionnelles') }}</h3>
                            <p>{{ __('Certaines communications par courrier électronique sont envoyées automatiquement à titre de messages transactionnels au sens de la Loi canadienne anti-pourriel (LCAP, L.C. 2010, ch. 23), notamment les avis d\'expiration de liens raccourcis, les confirmations de commande et les notifications de sécurité du compte. Ces messages ne constituent pas des communications commerciales et ne requièrent pas de consentement marketing. Chaque message inclut les coordonnées de l\'expéditeur et un mécanisme de désabonnement.') }}</p>

                            <h3 id="cookies">{{ __('11. Cookies et traceurs') }}</h3>
                            <p>{{ __('Des cookies de différentes catégories sont utilisés sur notre site. Vous pouvez gérer vos préférences à tout moment via notre bannière de consentement.') }}</p>
                            <div class="table-responsive">
                                <table class="table table-bordered table-striped" style="font-size: 13px;">
                                    <thead>
                                        <tr>
                                            <th>{{ __('Catégorie') }}</th>
                                            <th>{{ __('Cookie') }}</th>
                                            <th>{{ __('Fournisseur') }}</th>
                                            <th>{{ __('Finalité') }}</th>
                                            <th>{{ __('Durée') }}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                    @foreach($categories as $catKey => $category)
                                        @foreach($category['cookies'] as $cookie)
                                        <tr>
                                            <td>{{ $locale === 'fr' ? $category['label_fr'] : $category['label_en'] }}</td>
                                            <td><code>{{ $cookie['name'] }}</code></td>
                                            <td>{{ $cookie['provider'] }}</td>
                                            <td>{{ $locale === 'fr' ? $cookie['purpose_fr'] : $cookie['purpose_en'] }}</td>
                                            <td>{{ $cookie['duration'] }}</td>
                                        </tr>
                                        @endforeach
                                    @endforeach
                                    </tbody>
                                </table>
                            </div>
                            <p style="font-size: 13px;">
                                {{ __('Pour plus de détails, consultez notre') }} <a href="{{ url('/cookie-policy') }}">{{ __('politique des cookies') }}</a>.
                            </p>

                            <h3 id="bases">{{ __('12. Base juridique par traitement (RGPD art. 6)') }}</h3>
                            <div class="table-responsive">
                                <table class="table table-bordered table-striped" style="font-size: 13px;">
                                    <thead><tr><th>{{ __('Traitement') }}</th><th>{{ __('Base juridique') }}</th><th>{{ __('Article RGPD') }}</th></tr></thead>
                                    <tbody>
                                        <tr><td>{{ __('Gestion du compte utilisateur') }}</td><td>{{ __('Exécution d\'un contrat') }}</td><td>Art. 6(1)(b)</td></tr>
                                        <tr><td>{{ __('Cookies strictement nécessaires') }}</td><td>{{ __('Intérêt légitime') }}</td><td>Art. 6(1)(f)</td></tr>
                                        <tr><td>{{ __('Cookies d\'analyse (Analytics)') }}</td><td>{{ __('Consentement') }}</td><td>Art. 6(1)(a)</td></tr>
                                        <tr><td>{{ __('Envoi d\'infolettres') }}</td><td>{{ __('Consentement (LCAP)') }}</td><td>Art. 6(1)(a)</td></tr>
                                        <tr><td>{{ __('Génération de résumés par IA') }}</td><td>{{ __('Intérêt légitime') }}</td><td>Art. 6(1)(f)</td></tr>
                                        <tr><td>{{ __('Sécurité et prévention de la fraude') }}</td><td>{{ __('Intérêt légitime') }}</td><td>Art. 6(1)(f)</td></tr>
                                        <tr><td>{{ __('Statistiques liens courts') }}</td><td>{{ __('Intérêt légitime') }}</td><td>Art. 6(1)(f)</td></tr>
                                        <tr><td>{{ __('Contenu généré par les utilisateurs') }}</td><td>{{ __('Consentement') }}</td><td>Art. 6(1)(a)</td></tr>
                                        <tr><td>{{ __('Obligation légale') }}</td><td>{{ __('Obligation légale') }}</td><td>Art. 6(1)(c)</td></tr>
                                    </tbody>
                                </table>
                            </div>

                            <h3 id="sharing">{{ __('13. Prestataires et transferts internationaux') }}</h3>
                            <div class="table-responsive">
                                <table class="table table-bordered table-striped" style="font-size: 13px;">
                                    <thead><tr><th>{{ __('Prestataire') }}</th><th>{{ __('Finalité') }}</th><th>{{ __('Localisation') }}</th><th>{{ __('Mécanisme de transfert') }}</th></tr></thead>
                                    <tbody>
                                        <tr><td>Brevo</td><td>{{ __('Infolettre') }}</td><td>{{ __('Union européenne') }}</td><td>{{ __('Décision d\'adéquation') }}</td></tr>
                                        <tr><td>OpenRouter / Google</td><td>{{ __('Résumés IA') }}</td><td>{{ __('États-Unis') }}</td><td>{{ __('Clauses contractuelles types (SCC)') }}</td></tr>
                                        <tr><td>Cloudflare</td><td>{{ __('CDN, sécurité') }}</td><td>{{ __('Global') }}</td><td>{{ __('DPF UE-US') }}</td></tr>
                                        <tr><td>HostPapa</td><td>{{ __('Hébergement') }}</td><td>{{ __('États-Unis') }}</td><td>{{ __('Évaluation en cours conformément à l\'article 17 de la Loi 25, encadrement contractuel') }}</td></tr>
                                        <tr><td>Google Analytics 4</td><td>{{ __('Analyse d\'audience') }}</td><td>{{ __('États-Unis') }}</td><td>{{ __('SCC + mode consentement v2') }}</td></tr>
                                    </tbody>
                                </table>
                            </div>
                            <p>{{ __('Aucune donnée personnelle n\'est vendue à des tiers.') }}</p>

                            <h3 id="retention">{{ __('14. Durée de conservation') }}</h3>
                            <div class="table-responsive">
                                <table class="table table-bordered table-striped" style="font-size: 13px;">
                                    <thead><tr><th>{{ __('Type de donnée') }}</th><th>{{ __('Durée') }}</th><th>{{ __('Justification') }}</th></tr></thead>
                                    <tbody>
                                        <tr><td>{{ __('Données du compte') }}</td><td>{{ __('Effacées immédiatement à la suppression du compte') }}</td><td>{{ __('Sauf obligation légale (ex. pièces de facturation), conservées pour la durée exigée par la loi') }}</td></tr>
                                        <tr><td>{{ __('Logs de connexion') }}</td><td>{{ __('12 mois') }}</td><td>{{ __('Sécurité et audit') }}</td></tr>
                                        <tr><td>{{ __('Cookies analytics') }}</td><td>{{ __('14 mois max') }}</td><td>{{ __('Recommandation CNIL') }}</td></tr>
                                        <tr><td>{{ __('Preuves de consentement') }}</td><td>{{ __('5 ans') }}</td><td>{{ __('RGPD art. 7') }}</td></tr>
                                        <tr><td>{{ __('Données infolettre') }}</td><td>{{ __('Jusqu\'au désabonnement + 3 ans') }}</td><td>{{ __('LCAP, prescription') }}</td></tr>
                                        <tr><td>{{ __('Contributions UGC') }}</td><td>{{ __('Anonymisées (non supprimées) à la suppression du compte') }}</td><td>{{ __('Continuité des échanges publics') }}</td></tr>
                                        <tr><td>{{ __('Statistiques liens courts') }}</td><td>{{ __('12 mois') }}</td><td>{{ __('Anonymisation ultérieure') }}</td></tr>
                                        <tr><td>{{ __('Prompts sauvegardés supprimés par l\'utilisateur (corbeille)') }}</td><td>{{ __('30 jours après la suppression, puis effacement définitif') }}</td><td>{{ __('Minimisation des données - suppression automatique') }}</td></tr>
                                        <tr><td>{{ __('Sondages Décido (dates/options, réponses des participants)') }}</td><td>{{ __('2 à 3 mois selon le type, 30 jours après clôture, prolongeable de 3 mois (max. 2 fois) par le créateur') }}</td><td>{{ __('Minimisation des données - suppression automatique') }}</td></tr>
                                        <tr><td>{{ __('Demandes exercice de droits') }}</td><td>{{ __('Durée traitement + 3 ans') }}</td><td>{{ __('Preuve de traitement') }}</td></tr>
                                    </tbody>
                                </table>
                            </div>

                            <h3 id="breach">{{ __('15. Notification de brèche') }}</h3>
                            <p>{{ __('Conformément à l\'article 3.5 de la Loi 25, toute violation de données personnelles entraînant un risque d\'atteinte à la vie privée sera notifiée à la Commission d\'accès à l\'information du Québec (CAI) et aux personnes concernées sans délai indu.') }}</p>
                            <p>{{ __('En vertu du RGPD (art. 33-34), les autorités de contrôle compétentes seront notifiées dans un délai de 72 heures après avoir pris connaissance de la violation. Les personnes concernées seront également informées sans délai si la violation est susceptible d\'engendrer un risque élevé pour leurs droits et libertés.') }}</p>
                            <p>{{ __('Contact :') }} <a href="mailto:{{ $company['dpo_email'] }}">{{ $company['dpo_email'] }}</a></p>

                            <h3 id="rights">{{ __('16. Vos droits') }}</h3>
                            <p>{{ __('Conformément aux lois applicables, vous disposez des droits suivants :') }}</p>
                            <ul>
                                @foreach($rights['types'] as $right)
                                    <li>{{ $rightsLabels[$right] ?? $right }}</li>
                                @endforeach
                            </ul>
                            <p>
                                {{ __('Pour exercer vos droits, utilisez notre') }}
                                <a href="{{ route('legal.rights') }}">{{ __('formulaire de demande') }}</a>
                                {{ __('ou contactez notre DPO à l\'adresse') }}
                                <a href="mailto:{{ $company['dpo_email'] }}">{{ $company['dpo_email'] }}</a>.
                                {{ __('Nous répondrons dans un délai de') }}
                                <strong>{{ $rights['response_delay_days'] }} {{ __('jours') }}</strong>.
                                {{ __('Certaines demandes peuvent nécessiter la vérification de votre identité.') }}
                            </p>

                            <h3 id="eu">{{ __('17. Dispositions spécifiques visiteurs européens') }}</h3>
                            <p>{{ __('Les visiteurs issus de l\'Union européenne bénéficient des droits prévus par le RGPD, notamment : le droit d\'accès, de rectification, d\'effacement (« droit à l\'oubli »), de portabilité de leurs données, d\'opposition au traitement, de limitation du traitement, ainsi que le droit de retirer leur consentement à tout moment. Ils ont également le droit d\'introduire une réclamation auprès d\'une autorité de contrôle compétente (par exemple, la CNIL en France).') }}</p>
                            <p>{{ __('Lorsque des données sont transférées hors de l\'Union européenne, nous nous appuyons sur les mécanismes reconnus applicables, notamment les clauses contractuelles types (SCC) de nos fournisseurs, et nous évaluons ces transferts conformément aux lois applicables (voir la section sur les transferts hors Québec).') }}</p>
                            <p>{{ __('Le site laveille.ai ne procède pas à un profilage des utilisateurs produisant des effets juridiques les concernant ou les affectant de manière significative.') }}</p>

                            <h3 id="lia">{{ __('18. Intérêt légitime') }}</h3>
                            <p>{{ __('Lorsque l\'intérêt légitime est invoqué comme base juridique pour le traitement de vos données personnelles, l\'exploitant a procédé à une évaluation rigoureuse de la proportionnalité entre ses intérêts et vos droits et libertés fondamentaux. Vous disposez du droit de vous opposer à ces traitements.') }}</p>
                            <p>{{ __('Les traitements basés sur l\'intérêt légitime sont :') }}</p>
                            <ul>
                                <li>{{ __('Cookies strictement nécessaires au fonctionnement du site') }}</li>
                                <li>{{ __('Génération de résumés par IA pour améliorer l\'expérience utilisateur') }}</li>
                                <li>{{ __('Sécurité du site et prévention de la fraude') }}</li>
                                <li>{{ __('Statistiques sur l\'utilisation des liens courts') }}</li>
                            </ul>

                            <h3 id="security">{{ __('19. Mesures de sécurité') }}</h3>
                            <p>{{ __('Nous mettons en place des mesures techniques et organisationnelles pour protéger vos données :') }}</p>
                            <ul>
                                <li>{{ __('Chiffrement des données en transit (TLS) et au repos') }}</li>
                                <li>{{ __('Contrôles d\'accès stricts et authentification') }}</li>
                                <li>{{ __('Audits de sécurité réguliers') }}</li>
                                <li>{{ __('Formation du personnel à la protection des données') }}</li>
                            </ul>

                            <h3 id="efvp">{{ __('20. Évaluation des facteurs relatifs à la vie privée (EFVP)') }}</h3>
                            <p>{{ __('Conformément à l\'article 3.3 de la Loi modernisant des dispositions législatives en matière de protection des renseignements personnels (Loi 25, Québec), notre organisation s\'engage à effectuer une Évaluation des facteurs relatifs à la vie privée (EFVP) pour tout projet impliquant la collecte, l\'utilisation, la communication, la conservation ou la destruction de renseignements personnels.') }}</p>
                            <p>{{ __('Les types de projets visés par cette obligation incluent notamment :') }}</p>
                            <ul>
                                <li>{{ __('Tout nouveau traitement de renseignements personnels') }}</li>
                                <li>{{ __('L\'implantation d\'une nouvelle technologie ayant un impact sur la vie privée') }}</li>
                                <li>{{ __('Tout transfert de renseignements personnels à l\'extérieur du Québec') }}</li>
                                <li>{{ __('Les projets impliquant du profilage ou la prise de décision automatisée') }}</li>
                            </ul>
                            <p>{{ __('Le processus d\'EFVP comprend :') }}</p>
                            <ul>
                                <li>{{ __('L\'identification des risques d\'atteinte à la vie privée') }}</li>
                                <li>{{ __('La mise en place de mesures d\'atténuation appropriées') }}</li>
                                <li>{{ __('La consultation de la Commission d\'accès à l\'information (CAI) lorsqu\'un risque élevé est identifié') }}</li>
                            </ul>
                            <p>
                                {{ __('Un résumé non sensible de nos évaluations relatives aux communications hors Québec peut être obtenu sur demande écrite au responsable de la protection des renseignements personnels à l\'adresse :') }}
                                <a href="mailto:{{ $company['dpo_email'] }}">{{ $company['dpo_email'] }}</a>.
                            </p>

                            <h3 id="minors">{{ __('21. Mineurs') }}</h3>
                            <p>{{ __('Notre service n\'est pas destiné aux enfants. Conformément à l\'article 14 de la Loi sur la protection des renseignements personnels dans le secteur privé (RLRQ, c. P-39.1), le consentement au traitement des renseignements personnels d\'un mineur de moins de 14 ans doit être donné par le titulaire de l\'autorité parentale ou le tuteur; à partir de 14 ans, le mineur peut consentir lui-même. Toutefois, nos conditions d\'utilisation prévoient qu\'il faut avoir au moins 16 ans pour créer un compte sur notre site, et au moins 18 ans, ou détenir l\'autorisation d\'un parent ou tuteur, pour effectuer un achat dans notre boutique en ligne. Nous ne recueillons pas sciemment de renseignements personnels auprès d\'un mineur n\'ayant pas atteint l\'âge requis sans le consentement parental exigé par la loi, et nous supprimerons promptement tout renseignement ainsi recueilli dès que nous en serons informés.') }}</p>

                            <h3 id="contact">{{ __('22. Contact, DPO et autorités de contrôle') }}</h3>
                            <p>{{ __('Pour toute question ou exercice de vos droits :') }}</p>
                            <ul>
                                <li><strong>{{ __('DPO') }}&nbsp;:</strong> {{ $company['dpo_name'] }} - <a href="mailto:{{ $company['dpo_email'] }}">{{ $company['dpo_email'] }}</a></li>
                                <li><strong>{{ __('Adresse') }}&nbsp;:</strong> {{ $company['address'] }}</li>
                            </ul>
                            <p>{{ __('Vous pouvez également contacter les autorités de contrôle compétentes :') }}</p>
                            <ul>
                                @foreach($jurisdictions as $jKey => $jurisdiction)
                                    @if(!empty($jurisdiction['authorities']))
                                    <li>
                                        <strong>{{ $jurisdiction['label'] }}&nbsp;:</strong>
                                        @foreach($jurisdiction['authorities'] as $name => $url)
                                            <a href="{{ $url }}" target="_blank" rel="noopener">{{ $name }}</a>@if(!$loop->last), @endif
                                        @endforeach
                                    </li>
                                    @endif
                                @endforeach
                            </ul>

                            <hr>
                            <p style="color: #999; font-size: 12px;">
                                {{ __('Version') }} {{ $doc['version'] }} -
                                {{ __('Dernière mise à jour') }}&nbsp;: {{ \Carbon\Carbon::parse($doc['updated_at'])->translatedFormat('d F Y') }}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</section>
@endsection
