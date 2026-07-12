import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parse } from 'yaml';

async function readSource(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

async function readWorkflow(name) {
  const source = await readSource(`.github/workflows/${name}`);
  return { source, workflow: parse(source) };
}

function allSteps(workflow) {
  return Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
}

test('deploy workflow verifies with Node 24 and deploys a Pages artifact', async () => {
  const { workflow } = await readWorkflow('deploy.yml');
  const steps = allSteps(workflow);
  const manualGuard = steps.find((step) => step.name === 'Reject non-main manual run');
  const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  const setupNode = steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
  const commands = steps.map((step) => step.run).filter(Boolean).join('\n');
  const actions = steps.map((step) => step.uses).filter(Boolean);

  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'));
  assert.match(manualGuard?.if ?? '', /workflow_dispatch.*github\.ref.*refs\/heads\/main/);
  assert.match(manualGuard?.run ?? '', /exit 1/);
  assert.ok(steps.indexOf(manualGuard) < steps.indexOf(checkout));
  assert.equal(checkout?.with?.ref, 'main');
  assert.equal(checkout?.with?.['persist-credentials'], false);
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.jobs.build.permissions, {
    contents: 'read',
    pages: 'read',
  });
  assert.deepEqual(workflow.jobs.deploy.permissions, {
    pages: 'write',
    'id-token': 'write',
  });
  assert.equal(String(setupNode?.with?.['node-version']), '24');
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  assert.match(commands, /npm ci/);
  assert.match(commands, /npm run verify/);
  assert.ok(actions.some((action) => action.startsWith('actions/configure-pages@')));
  assert.ok(actions.some((action) => action.startsWith('actions/upload-pages-artifact@')));
  assert.ok(actions.some((action) => action.startsWith('actions/deploy-pages@')));
});

test('Feishu sync workflow exposes only the required triggers and four Feishu secrets', async () => {
  const { source, workflow } = await readWorkflow('sync-feishu.yml');
  const steps = workflow.jobs.sync.steps;
  const manualGuard = steps.find((step) => step.name === 'Reject non-main manual run');
  const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  const setupNode = steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
  const commands = steps.map((step) => step.run).filter(Boolean).join('\n');
  const secretReferences = [
    ...new Set(source.match(/secrets\.(FEISHU_[A-Z0-9_]+)/g)?.map((value) => value.slice(8)) ?? []),
  ].sort();

  assert.ok(!Object.hasOwn(workflow.on, 'repository_dispatch'));
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'));
  assert.deepEqual(workflow.on.schedule, [{ cron: '*/30 * * * *' }]);
  assert.match(manualGuard?.if ?? '', /workflow_dispatch.*github\.ref.*refs\/heads\/main/);
  assert.match(manualGuard?.run ?? '', /exit 1/);
  assert.ok(steps.indexOf(manualGuard) < steps.indexOf(checkout));
  assert.equal(workflow.jobs.sync.permissions.contents, 'write');
  assert.equal(checkout?.with?.ref, 'main');
  assert.equal(checkout?.with?.['persist-credentials'], false);
  assert.equal(String(setupNode?.with?.['node-version']), '24');
  assert.match(commands, /npm ci/);
  assert.match(commands, /npm run sync:feishu/);
  assert.deepEqual(secretReferences, [
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
    'FEISHU_BITABLE_APP_TOKEN',
    'FEISHU_BITABLE_TABLE_ID',
  ]);
});

test('Feishu workflow stages only generated posts, media, and the manifest', async () => {
  const { source, workflow } = await readWorkflow('sync-feishu.yml');
  const steps = workflow.jobs.sync.steps;
  const syncIndex = steps.findIndex((step) => step.run === 'npm run sync:feishu');
  const verifyIndex = steps.findIndex((step) => step.run === 'npm run verify');
  const commitIndex = steps.findIndex((step) => step.id === 'commit');
  const commit = steps[commitIndex];

  assert.match(
    source,
    /git add -- src\/content\/posts\/feishu public\/media\/feishu \.feishu-manifest\.json/,
  );
  assert.doesNotMatch(source, /git add\s+(?:-A|\.)/);
  assert.match(source, /git diff --cached --quiet/);
  assert.match(source, /git commit/);
  assert.equal(commit?.env?.GITHUB_TOKEN, '${{ github.token }}');
  assert.match(source, /AUTHORIZATION: basic/);
  assert.match(source, /push "https:\/\/github\.com\//);
  assert.doesNotMatch(source, /persist-credentials:\s*true/);
  assert.ok(syncIndex >= 0, 'sync step is present');
  assert.ok(verifyIndex > syncIndex, 'verification runs after synchronization');
  assert.ok(commitIndex > verifyIndex, 'verification runs before content is committed');
});

test('a changed Feishu sync deploys Pages directly without a dispatch gap', async () => {
  const [{ source: deploySource, workflow: deploy }, { source: syncSource, workflow: sync }] =
    await Promise.all([readWorkflow('deploy.yml'), readWorkflow('sync-feishu.yml')]);
  const deployJob = sync.jobs.deploy;
  const deployActions = deployJob.steps.map((step) => step.uses).filter(Boolean);
  const syncSteps = sync.jobs.sync.steps;
  const verifiedArtifact = syncSteps.find((step) =>
    step.uses?.startsWith('actions/upload-pages-artifact@'),
  );
  const verifyIndex = syncSteps.findIndex((step) => step.run === 'npm run verify');
  const uploadIndex = syncSteps.indexOf(verifiedArtifact);
  const commitIndex = syncSteps.findIndex((step) => step.id === 'commit');

  assert.equal(sync.jobs.sync.outputs.changed, '${{ steps.commit.outputs.changed }}');
  assert.equal(deployJob.needs, 'sync');
  assert.equal(deployJob.if, "needs.sync.outputs.changed == 'true'");
  assert.ok(!Object.hasOwn(deployJob.permissions, 'contents'));
  assert.equal(deployJob.permissions.pages, 'write');
  assert.equal(deployJob.permissions['id-token'], 'write');
  assert.equal(deployJob.environment.name, 'github-pages');
  assert.ok(verifyIndex >= 0 && uploadIndex > verifyIndex && commitIndex > uploadIndex);
  assert.equal(verifiedArtifact?.with?.path, './dist');
  assert.ok(deployActions.some((action) => action.startsWith('actions/configure-pages@')));
  assert.ok(deployActions.some((action) => action.startsWith('actions/deploy-pages@')));
  assert.ok(!deployActions.some((action) => action.startsWith('actions/checkout@')));
  assert.ok(!deployActions.some((action) => action.startsWith('actions/setup-node@')));
  assert.ok(!deployJob.steps.some((step) => /npm\s/.test(step.run ?? '')));
  assert.match(syncSource, /id:\s*commit/);
  assert.match(syncSource, /changed=true/);
  assert.doesNotMatch(syncSource, /feishu_content_synced/);
  assert.doesNotMatch(deploySource, /repository_dispatch/);
  assert.ok(!Object.hasOwn(deploy.on, 'repository_dispatch'));
});

test('setup documentation covers the complete Feishu and GitHub handoff without real secrets', async () => {
  const [setup, readme] = await Promise.all([
    readSource('docs/FEISHU_SETUP.md'),
    readSource('README.md'),
  ]);

  for (const field of [
    '标题',
    '文档链接',
    'Slug',
    '摘要',
    '标签',
    '发布日期',
    '状态',
    '精选',
    '封面',
  ]) {
    assert.match(setup, new RegExp(field));
  }

  for (const secret of [
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
    'FEISHU_BITABLE_APP_TOKEN',
    'FEISHU_BITABLE_TABLE_ID',
  ]) {
    assert.match(setup, new RegExp(secret));
  }

  assert.match(setup, /查看新版文档/);
  assert.match(setup, /下载云文档中的图片和附件/);
  assert.match(setup, /docs:document\.media:download/);
  assert.doesNotMatch(setup, /drive:media:download/);
  assert.match(setup, /共享|添加文档应用/);
  assert.doesNotMatch(setup, /repository_dispatch|feishu_publish/);
  assert.match(setup, /XMo2004\/XMo2004\.github\.io/);
  assert.match(setup, /actions\/workflows\/sync-feishu\.yml\/dispatches/);
  assert.match(setup, /\{"ref":"main"\}/);
  assert.match(setup, /X-GitHub-Api-Version:\s*2026-03-10/);
  assert.match(setup, /状态.*发生变化/);
  assert.match(setup, /已下线.*立即撤下/);
  assert.match(setup, /fine-grained|细粒度/i);
  assert.match(setup, /Actions.*读写|Actions.*Read and write/is);
  assert.match(setup, /HTTP 200/);
  assert.match(setup, /npm run sync:feishu/);
  assert.match(setup, /排障|故障/);
  assert.match(setup, /Settings.*Pages.*GitHub Actions/is);
  assert.match(setup, /github-pages.*main/is);
  assert.match(setup, /手动.*main|main.*手动/is);
  assert.match(setup, /重新运行|重新执行/);
  assert.match(setup, /git revert/);
  assert.match(setup, /App Secret.*轮换|轮换.*App Secret/is);
  assert.match(setup, /PAT.*轮换|轮换.*PAT/is);
  assert.match(readme, /FEISHU_SETUP\.md/);
  assert.match(readme, /npm run verify/);
  assert.match(readme, /npm run sync:feishu/);
  assert.match(readme, /同步.*直接.*部署|直接.*部署.*同步/s);
  assert.doesNotMatch(readme, /内部 dispatch/);

  const combined = `${setup}\n${readme}`;
  assert.doesNotMatch(combined, /feishu_content_synced/);
  assert.doesNotMatch(combined, /ghp_[A-Za-z0-9]{20,}/);
  assert.doesNotMatch(combined, /github_pat_[A-Za-z0-9_]{20,}/);
  assert.doesNotMatch(combined, /t-[A-Za-z0-9]{24,}/);
});

test('remote Actions are pinned to immutable SHAs and Dependabot maintains them', async () => {
  const workflowNames = ['deploy.yml', 'sync-feishu.yml'];
  for (const name of workflowNames) {
    const source = await readSource(`.github/workflows/${name}`);
    const remoteUses = [...source.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
    assert.ok(remoteUses.length > 0, `${name} has remote Actions`);
    for (const action of remoteUses) {
      if (action.startsWith('./')) continue;
      assert.match(action, /^[^@\s]+@[0-9a-f]{40}$/, `${action} must use a full SHA`);
    }
  }

  const dependabot = parse(await readSource('.github/dependabot.yml'));
  const actionsUpdate = dependabot.updates.find(
    (entry) => entry['package-ecosystem'] === 'github-actions',
  );
  assert.equal(actionsUpdate?.directory, '/');
  assert.equal(actionsUpdate?.schedule?.interval, 'weekly');
});
