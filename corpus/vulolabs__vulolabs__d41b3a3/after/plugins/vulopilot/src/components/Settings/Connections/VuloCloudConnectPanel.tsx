/* global appLocalizer */
import { useEffect, useState } from 'react';
import { __ } from '@wordpress/i18n';
import { getApiLink, getApiResponse, sendApiResponse } from '@zyra/core';
import {
	FormGroupWrapperComponent,
	FormGroupComponent,
	NoticeComponent,
	NoticeManager,
	PopupComponent,
} from '@zyra/components';
import { ButtonInput } from '@zyra/inputs';
import ShowProPopup from '../../Popup/Popup';

interface VuloCloudConnectStatus {
	connected: boolean;
	organization_id: string;
	brand_id: string;
	/** This Organization's own public storefront domain — display only. */
	domain: string;
	connected_at: string;
}

const nonceHeaders = { headers: { 'X-WP-Nonce': appLocalizer.nonce } };

/**
 * Settings → Connections → VuloCloud.
 *
 * The generic "connect this site to a pre-known VuloCloud Organization +
 * Brand" panel (VULOPILOT_VULOCLOUD_CONFIG/VuloCloudConnection) — a plain
 * sibling to AiProvidersPanel.tsx's own "Connect to VuloCloud" section,
 * not the same connection: that one is about an AI provider key,
 * unconditionally AI-Credits-shaped; this one is about Organization/
 * Brand-scoped data access (offerings, pricing, ...) and has nothing to
 * do with AI credits. Same request/response shapes and UI pattern,
 * copied deliberately rather than shared, since the two connections are
 * genuinely independent on the vulocloud side too (separate admin-post
 * callback actions, separate stored options).
 */
const VuloCloudConnectPanel = () => {
	const [status, setStatus] = useState<VuloCloudConnectStatus>({
		connected: false,
		organization_id: '',
		brand_id: '',
		domain: '',
		connected_at: '',
	});
	const [isConnecting, setIsConnecting] = useState(false);
	const [isDisconnecting, setIsDisconnecting] = useState(false);
	const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
	const [isLoading, setIsLoading] = useState(true);

	const load = () => {
		setIsLoading(true);

		getApiResponse<VuloCloudConnectStatus>(
			getApiLink(appLocalizer, 'vulocloud-connect/status'),
			nonceHeaders
		)
			.then((response) => {
				if (!response) {
					return;
				}

				setStatus(response);
			})
			.finally(() => setIsLoading(false));
	};

	useEffect(load, []);

	// VuloCloudConnectCallbackHandler.php's own redirect lands back on this
	// exact URL carrying `vulocloud_connect_status=connected|error` — same
	// `?_status=` redirect-flag handling AiProvidersPanel.tsx's own
	// connect-broker effect already establishes (a different query param
	// name, since these are two independent connections/callbacks).
	useEffect(() => {
		const params = new URLSearchParams(
			window.location.hash.split('?')[1] || window.location.hash.substring(1)
		);
		const connectStatus = params.get('vulocloud_connect_status');

		if ('connected' === connectStatus) {
			NoticeManager.add({
				uniqueKey: 'vulopilot-vulocloud-connect-connected',
				type: 'success',
				position: 'float',
				message: __('Connected to VuloCloud.', 'vulopilot'),
			});
		} else if ('error' === connectStatus) {
			NoticeManager.add({
				uniqueKey: 'vulopilot-vulocloud-connect-failed',
				type: 'error',
				position: 'float',
				message: __('Could not connect to VuloCloud. Please try again.', 'vulopilot'),
			});
		}
	}, []);

	const handleConnect = () => {
		setIsConnecting(true);

		getApiResponse<{ url: string }>(
			getApiLink(appLocalizer, 'vulocloud-connect/broker-authorize-url'),
			nonceHeaders
		)
			.then((response) => {
				if (response?.url) {
					window.location.href = response.url;
					return;
				}

				setIsConnecting(false);
				NoticeManager.add({
					uniqueKey: 'vulopilot-vulocloud-connect-unavailable',
					type: 'error',
					position: 'float',
					message: __('VuloCloud isn’t configured for this build yet.', 'vulopilot'),
				});
			})
			.catch(() => setIsConnecting(false));
	};

	/** Opens the confirm popup — the actual disconnect runs from `handleConfirmDisconnect` once the user confirms there. */
	const handleDisconnect = () => {
		setShowDisconnectConfirm(true);
	};

	const handleConfirmDisconnect = () => {
		setShowDisconnectConfirm(false);
		setIsDisconnecting(true);

		sendApiResponse(appLocalizer, getApiLink(appLocalizer, 'vulocloud-connect/disconnect'), {})
			.then((response) => {
				NoticeManager.add({
					uniqueKey: 'vulopilot-vulocloud-connect-disconnected',
					type: response ? 'success' : 'error',
					position: 'float',
					message: response
						? __('Disconnected from VuloCloud.', 'vulopilot')
						: __('Could not disconnect from VuloCloud.', 'vulopilot'),
				});

				if (response) {
					load();
				}
			})
			.finally(() => setIsDisconnecting(false));
	};

	return (
		<>
			<FormGroupWrapperComponent>
				{isLoading ? (
					<div className="desc">{__('Loading…', 'vulopilot')}</div>
				) : (
					<FormGroupComponent label={__('VuloCloud Connection', 'vulopilot')}>
						{!status.connected ? (
							<>
								<NoticeComponent
									displayPosition="inline"
									type="info"
									message={__(
										'Connect this site to your VuloCloud Organization and Brand.',
										'vulopilot'
									)}
								/>
								<ButtonInput
									position="left"
									buttons={{
										text: isConnecting
											? __('Connecting…', 'vulopilot')
											: __('Connect to VuloCloud', 'vulopilot'),
										disabled: isConnecting,
										onClick: handleConnect,
									}}
								/>
							</>
						) : (
							<>
								<NoticeComponent
									displayPosition="inline"
									type="success"
									message={
										status.domain
											? // translators: %s is the connected Organization's own storefront domain.
											  __('Connected — ', 'vulopilot') + status.domain
											: __('Connected to VuloCloud.', 'vulopilot')
									}
								/>
								<ButtonInput
									position="left"
									buttons={{
										text: isDisconnecting
											? __('Disconnecting…', 'vulopilot')
											: __('Disconnect', 'vulopilot'),
										disabled: isDisconnecting,
										onClick: handleDisconnect,
									}}
								/>
							</>
						)}
					</FormGroupComponent>
				)}
			</FormGroupWrapperComponent>
			<PopupComponent
				position="lightbox"
				open={showDisconnectConfirm}
				onClose={() => setShowDisconnectConfirm(false)}
				width={31.25}
				height="auto"
			>
				<ShowProPopup
					confirmMode
					title={__('Disconnect VuloCloud', 'vulopilot')}
					confirmMessage={__(
						'Disconnect this site from VuloCloud? Any features that depend on this connection will stop working until you connect again.',
						'vulopilot'
					)}
					confirmYesText={__('Disconnect', 'vulopilot')}
					confirmNoText={__('Cancel', 'vulopilot')}
					onConfirm={handleConfirmDisconnect}
					onCancel={() => setShowDisconnectConfirm(false)}
				/>
			</PopupComponent>
		</>
	);
};

export default VuloCloudConnectPanel;
