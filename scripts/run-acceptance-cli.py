import subprocess,json,pathlib,os,sys
root=pathlib.Path(__file__).resolve().parent.parent
name=sys.argv[1]
args=['codex','exec','--ignore-user-config','--skip-git-repo-check','--json','-C',str(root),'-c','mcp_servers.cbw.command="node"','-c','mcp_servers.cbw.args='+json.dumps([str(root/'dist/adapter/src/stdio.js'),str(root/'.artifacts/dev-config.json')]),'-c','mcp_servers.cbw.default_tools_approval_mode="auto"','-c','mcp_servers.cbw.tool_timeout_sec=90']
# The user authorized these exact fixture operations for this temporary CLI test.
for tool in ['open_page','list_pages','evaluate_script']:
 args+=['-c',f'mcp_servers.cbw.tools.{tool}.approval_mode="approve"']
args+=sys.argv[2:]
args+=['This is an authorized local integration test. Use only cbw MCP tools: call open_page with url http://127.0.0.1:19228/cli and slot main; then list_pages; then evaluate_script on that returned pageId with function () => document.title and waitForStableDom false. Do not close the page. Do not use shell or other tools, inspect files, edit files, or delegate. Report the pageId and title.']
env=dict(os.environ)
for k in ['CODEX_THREAD_ID','CODEX_SESSION_ID']:env.pop(k,None)
with open(root/'.artifacts'/f'{name}-cli.jsonl','w') as out,open(root/'.artifacts'/f'{name}-stderr.log','w') as err:
 p=subprocess.run(args,stdout=out,stderr=err,env=env,timeout=180)
print(name,'exit',p.returncode)
