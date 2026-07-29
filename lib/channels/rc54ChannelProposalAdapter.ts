import { compileReleaseManifest } from "./channelControlPlane";
import {
  buildOperatorProposal,
  type BuiltOperatorProposal,
} from "./channelProposalWrite";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture";

/**
 * Temporary adapter for the currently sealed RC5.4 runtime. The generic
 * proposal builder deliberately has no RC5.4 import or economic defaults.
 */
export function buildRc54OperatorProposal(
  value: unknown,
  operatorId: string,
  requestId: string,
  createdAt = new Date().toISOString(),
): BuiltOperatorProposal {
  return buildOperatorProposal(
    compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE),
    value,
    operatorId,
    requestId,
    createdAt,
  );
}
