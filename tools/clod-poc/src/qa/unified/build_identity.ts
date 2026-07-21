export interface QaBuildIdentity {
  commitSha: string;
  workingTreeDirty: boolean;
  packageLockSha256: string;
  mode: string;
}

export function qaBuildIdentity(): QaBuildIdentity {
  return Object.freeze({ ...__DRUSNIEL_QA_BUILD_IDENTITY__ });
}
