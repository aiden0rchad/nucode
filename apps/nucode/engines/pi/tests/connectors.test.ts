import test from "node:test";
import assert from "node:assert/strict";
import { canonicalMcpName, connectorDecision, connectorVerdict, type Connector } from "../extensions/lib/connectors.ts";

test("browser read tools never ask; mutations ask unless the thread has full access", () => {
  const browser: Connector = {id:"nucode-browser",enabled:true,approval:"ask"};
  const decide = (name: string, mode="ask", interactive=true) => connectorDecision([browser],`mcp__nucode_browser__browser_${name}`,mode,interactive);
  for (const name of ["snapshot","get_text","take_screenshot","console_messages","network_requests","tabs","navigate","navigate_back","wait_for"]) {
    assert.equal(decide(name),"allow"); assert.equal(decide(name,"read-only",false),"allow");
  }
  for (const name of ["click","type","fill_form","select_option","drag","drop","file_upload","evaluate","run_code_unsafe","press_key","handle_dialog","set_cookie","set_storage","future_mutation"]) {
    assert.equal(decide(name),"ask"); assert.equal(decide(name,"full-access"),"allow"); assert.equal(decide(name,"read-only"),"block"); assert.equal(decide(name,"ask",false),"block");
  }
  for (const tool of ["web_search", "web_fetch"]) {
    for (const mode of ["ask", "read-only", "full-access"]) assert.equal(connectorDecision([browser], `mcp__nucode_browser__${tool}`, mode, false), "allow");
    browser.toolDenylist = [tool];
    assert.equal(connectorDecision([browser], `mcp__nucode_browser__${tool}`, "full-access", true), "block");
    browser.toolDenylist = undefined;
  }
  browser.approval="auto"; assert.equal(decide("click"),"allow");
  browser.toolDenylist=["browser_snapshot"]; assert.equal(decide("snapshot"),"block");
});

test("connector allow/deny and approval rules apply across access modes", () => {
  const server: Connector = { id: "test-server", enabled: true, approval: "ask", toolAllowlist: ["read", "write"], toolDenylist: ["write"] };
  const decide = (tool: string, mode = "full-access", interactive = true) => connectorDecision([server], `mcp__test_server__${tool}`, mode, interactive);
  assert.equal(decide("read"), "allow");
  assert.equal(decide("read", "ask"), "ask");
  assert.equal(decide("write"), "block");
  assert.equal(decide("unknown"), "block");
  assert.equal(decide("read", "read-only"), "block");
  assert.equal(decide("read", "ask", false), "block");
  server.approval = "auto";
  assert.equal(decide("read", "ask"), "allow");
  server.enabled = false;
  assert.equal(decide("read"), "block");
  assert.equal(connectorDecision([], "mcp__unknown__read", "full-access", true), "block");
});

test("computer actions use host policy while connector restrictions still apply", () => {
  const computer: Connector = { id: "nucode-computer", enabled: true, approval: "ask" };
  const decide = (tool: string, mode = "full-access") => connectorDecision([computer], `mcp__nucode_computer__${tool}`, mode, false);
  assert.equal(decide("computer_run_task"), "allow");
  assert.equal(decide("computer_run_task", "read-only"), "block");
  assert.equal(decide("computer_screenshot", "read-only"), "allow");
  computer.toolDenylist = ["computer_screenshot"];
  assert.equal(decide("computer_screenshot"), "block");
  computer.enabled = false;
  assert.equal(decide("computer_run_task"), "block");
});

test("each block reason tells the model what to do instead", () => {
  const browser: Connector = { id: "nucode-browser", enabled: true, approval: "ask" };
  const reason = (mode: string, interactive: boolean) => connectorVerdict([browser], "mcp__nucode_browser__browser_click", mode, interactive).reason;
  assert.match(reason("read-only", true)!, /browser_click is unavailable: this thread has read-only access.*browser_get_text.*Ask or Full access/);
  assert.match(reason("ask", false)!, /needs the user's approval.*cannot ask.*browser_get_text/);
  browser.toolDenylist = ["browser_click"];
  assert.match(reason("full-access", true)!, /disabled this tool/);
  browser.toolDenylist = undefined; browser.toolAllowlist = ["browser_type"];
  assert.match(reason("full-access", true)!, /allowed tool list/);
  browser.toolAllowlist = undefined; browser.enabled = false;
  assert.match(reason("full-access", true)!, /connector is disabled/);
  assert.equal(connectorVerdict([browser], "mcp__nucode_browser__browser_click", "ask", true).decision, "block");
  assert.equal(connectorVerdict([], "mcp__nucode_browser__x", "ask", true).decision, "block");
  browser.enabled = true;
  assert.equal(connectorVerdict([browser], "mcp__nucode_browser__browser_click", "ask", true).reason, undefined);
});

test("omp connector tool names map back to the policy form", () => {
  const servers: Connector[] = [{ id: "nucode-browser", enabled: true, approval: "ask" }];
  assert.equal(canonicalMcpName(servers, "mcp__nucode_browser_browser_click"), "mcp__nucode_browser__browser_click");
  assert.equal(canonicalMcpName(servers, "mcp__nucode_browser__browser_click"), "mcp__nucode_browser__browser_click");
  assert.equal(canonicalMcpName(servers, "mcp__other_thing"), undefined);
});
