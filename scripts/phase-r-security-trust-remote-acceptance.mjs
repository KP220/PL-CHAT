import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const server = read('trial-server/server.mjs');
const pkg = JSON.parse(read('package.json'));

const checks = [
  ['LAN-only guard defaults on', server.includes("PL_CHAT_LAN_ONLY || 'true'") && server.includes('lanOnlyAccess')],
  ['LAN-only guard recognizes private LAN ranges', server.includes('parts[0] === 10') && server.includes('parts[0] === 192 && parts[1] === 168') && server.includes('parts[0] === 172')],
  ['LAN-only guard blocks non-LAN requests', server.includes('allowLanRequest(request)') && server.includes("'lan_only'")],
  ['Health/admin expose LAN-only status', server.includes('lanOnlyAccess,') && server.includes('hostAdminStatus')],
  ['Authentication still requires email verification by default', server.includes("EMAIL_VERIFICATION_REQUIRED || 'true'")],
  ['Admin routes require isAdmin', server.includes("path === '/api/admin/host/status'") && server.includes('if (!isAdmin(user))')],
  ['Audit log records host backup/restart actions', server.includes("addAudit('host.backup.created'") && server.includes("addAudit('host.restart.requested'")],
  ['Code signing remains explicit unsigned build', pkg.build?.win?.signAndEditExecutable !== true],
  ['Phase 5 doc exists', fs.existsSync(path.join(root, 'docs/LAN_V1_PHASE_5_SECURITY.md'))],
  ['Phase 6 doc exists', fs.existsSync(path.join(root, 'docs/LAN_V1_PHASE_6_CODE_SIGNING.md'))],
  ['Phase 7 doc exists', fs.existsSync(path.join(root, 'docs/LAN_V1_PHASE_7_REMOTE_ACCESS.md'))]
];

const failed = checks.filter(([, pass]) => !pass);
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'HOLD'} | ${name}`);
if (failed.length) {
  console.log(`HOLD: ${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(1);
}
console.log(`PASS: ${checks.length}/${checks.length} checks passed`);
