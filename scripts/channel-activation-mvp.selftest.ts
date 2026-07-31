const tests = [
  "../lib/channels/channelControlPlane.selftest.ts",
  "../lib/channels/channelControlPlanePersistence.selftest.ts",
  "../lib/channels/channelControlPlaneOperatorView.selftest.ts",
  "../lib/channels/channelControlMutationWindow.selftest.ts",
  "../lib/channels/researchChannelRegistry.selftest.ts",
  "../lib/channels/researchChannelPreregistration.selftest.ts",
  "../app/api/research-channel-registry/route.selftest.ts",
  "../lib/channels/channelPortfolioCapacity.selftest.ts",
  "../lib/channels/channelPortfolioCapacityPolicy.selftest.ts",
  "../lib/channels/channelRosterBundle.selftest.ts",
  "../lib/channels/channelRosterBundlePersistence.selftest.ts",
  "../lib/channels/channelRosterBundleActivation.selftest.ts",
  "../lib/channels/channelRosterBundleServerContext.selftest.ts",
  "../lib/channels/channelRosterBundleReadProjection.selftest.ts",
  "../lib/channels/channelRosterBundleRollback.selftest.ts",
  "../app/api/channel-roster-bundles/route.selftest.ts",
  "../app/api/channel-roster-bundles/preview/route.selftest.ts",
  "../app/api/channel-roster-bundles/apply/route.selftest.ts",
  "../app/api/channel-roster-bundles/rollback/route.selftest.ts",
  "../components/studio/ChannelRosterActivationConsole.selftest.ts",
  "../worker/src/channelActivationShadowAdapter.selftest.ts",
  "../worker/src/channelActivationPreviewWatcher.selftest.ts",
  "../worker/src/channelRosterBundleWatcher.selftest.ts",
  "../worker/src/channelConfigurationRuntimeAdapter.selftest.ts",
  "../worker/src/channelConfigurationRuntimeBridge.selftest.ts",
  "../lib/channels/channelCollectionState.selftest.ts",
  "../worker/src/channelCollectionRuntime.selftest.ts",
  "../worker/src/channelEpochEvidencePersistence.selftest.ts",
  "../worker/src/channelEpochEvidenceRuntime.selftest.ts",
  "../lib/channels/channelActivationPersistence.selftest.ts",
  "../lib/channels/channelProposalWrite.selftest.ts",
  "../worker/src/temporaryRc54RuntimeAdapter.selftest.ts",
  "../lib/ops/brokerReconciliation.selftest.ts",
] as const;

async function main(): Promise<void> {
  for (const test of tests) {
    await import(new URL(test, import.meta.url).href);
  }
  console.log(`channel-activation-mvp-selftest: ${tests.length}/${tests.length} modules passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
