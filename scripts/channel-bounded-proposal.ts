import { buildRc54BoundedProposalCanary } from "../lib/channels/rc54BoundedProposalCanary";

const artifact = buildRc54BoundedProposalCanary();
console.log(JSON.stringify(artifact, null, 2));
