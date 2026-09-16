import { __ } from '@wordpress/i18n';
import VuloCloudConnectPanel from './VuloCloudConnectPanel';

/**
 * Settings → Connections → VuloCloud — the generic "connect this plugin
 * to a pre-known VuloCloud Organization + Brand" connection
 * (VULOPILOT_VULOCLOUD_CONFIG), entirely independent from the "AI
 * Providers" tab's own, unrelated VuloCloud AI-Credits connection. Same
 * auto-discovered-by-templateService.ts shape as every sibling tab file
 * in this folder (AiProviders.ts, GoogleServices.ts, ...).
 */
export default {
	id: 'vulocloud-connect',
	priority: 2,
	headerTitle: __( 'VuloCloud', 'vulopilot' ),
	headerDescription: __(
		'Connect this site to your VuloCloud Organization and Brand.',
		'vulopilot'
	),
	headerIcon: 'cloud-upload',
	submitUrl: 'settings',
	modal: [],
	PanelComponent: VuloCloudConnectPanel,
};
