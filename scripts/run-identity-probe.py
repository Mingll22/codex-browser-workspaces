import subprocess,json,pathlib,os,sys
root=pathlib.Path(__file__).resolve().parent.parent
name=sys.argv[1]
args=['codex','exec','--ignore-user-config','--skip-git-repo-check','--json','-C',str(root),'-c','mcp_servers.cbw_probe.command="node"','-c','mcp_servers.cbw_probe.args='+json.dumps([str(root/'scripts/identity-probe.mjs'),str(root/'.artifacts'/f'{name}-wire.jsonl')])]
if len(sys.argv)>2:args+=sys.argv[2:]
args+=['Call the cbw_probe identity_probe MCP tool exactly once with no arguments. This is an integration test; do not use other tools, read files, edit files, or delegate. Then reply ok.']
env=dict(os.environ)
for k in ['CODEX_THREAD_ID','CODEX_SESSION_ID']:env.pop(k,None)
with open(root/'.artifacts'/f'{name}-cli.jsonl','w') as out,open(root/'.artifacts'/f'{name}-stderr.log','w') as err:
 p=subprocess.run(args,stdout=out,stderr=err,env=env,timeout=100)
print(name,'exit',p.returncode)
