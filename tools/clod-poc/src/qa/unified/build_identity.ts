export interface QaBuildIdentity {
  commitSha: string;
  workingTreeDirty: boolean;
  packageLockSha256: string;
  mode: string;
}

const UNKNOWN_BUILD_IDENTITY: QaBuildIdentity = {
  commitSha: "unknown",
  workingTreeDirty: true,
  packageLockSha256: "unknown",
  mode: "unknown",
};

export function qaBuildIdentity(): QaBuildIdentity {
  const identity = typeof __DRUSNIEL_QA_BUILD_IDENTITY__ === "undefined"
    ? UNKNOWN_BUILD_IDENTITY
    : __DRUSNIEL_QA_BUILD_IDENTITY__;
  return Object.freeze({ ...identity });
}
