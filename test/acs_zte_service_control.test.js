const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildZteServiceControlRows,
  extractZteAclServiceControl,
  ACL_PATH,
} = require('../backend/acs_zte_service_control');

test('buildZteServiceControlRows: aktifkan ACL dan port control', () => {
  const on = buildZteServiceControlRows(true);
  assert.ok(on.some(([path]) => path === ACL_PATH));
  assert.ok(on.some(([path, value]) => path.endsWith('.Enable') && value === true));
  const off = buildZteServiceControlRows(false);
  assert.equal(off.find(([path]) => path === ACL_PATH)?.[1], 0);
});

test('extractZteAclServiceControl: baca AclServices dan fallback port control', () => {
  assert.equal(extractZteAclServiceControl({}), '-');
  const aclOn = {
    InternetGatewayDevice: {
      'X_ZTE-COM_Security': { AclServices: { _value: 1 } },
    },
  };
  assert.equal(extractZteAclServiceControl(aclOn), 'Enabled');
  const portOnly = {
    InternetGatewayDevice: {
      'X_ZTE-COM_Security': {
        IPv4RemoteServicePortControl: { 1: { Enable: { _value: true } } },
      },
    },
  };
  assert.equal(extractZteAclServiceControl(portOnly), 'Enabled');
});
