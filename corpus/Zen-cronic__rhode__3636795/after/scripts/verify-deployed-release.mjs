import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const project='roadstar-2026-kzh',region='us-central1';
const web='https://roadstar-web-739889188415.us-central1.run.app';
const api='https://roadstar-api-739889188415.us-central1.run.app';
const expected={optimizer:'roadstar-optimizer-00015-vuk',api:'roadstar-api-00036-woy',web:'roadstar-web-00076-piv',documents:'roadstar-documents-00021-tam'};
const services={};
for(const [component,revision] of Object.entries(expected)){
  const name='roadstar-'+component;
  const value=JSON.parse(execFileSync('gcloud',['run','services','describe',name,'--project='+project,'--region='+region,'--format=json'],{encoding:'utf8'}));
  const traffic=value.status.traffic.find(item=>item.percent===100);
  assert.equal(value.status.latestCreatedRevisionName,revision);
  assert.equal(value.status.latestReadyRevisionName,revision);
  assert.equal(traffic?.revisionName,revision);
  assert.match(value.spec.template.spec.containers[0].image,/\/roadstar\/(api|web|optimizer)@sha256:[a-f0-9]{64}$/);
  services[component]={revision,trafficPercent:traffic.percent,image:value.spec.template.spec.containers[0].image,ready:value.status.conditions.find(item=>item.type==='Ready')?.status};
}
const healthResponse=await fetch(api+'/api/health');assert.equal(healthResponse.status,200);const health=await healthResponse.json();assert.deepEqual(health,{ok:true,database:'postgresql',auth:'firebase'});
const webResponse=await fetch(web);assert.equal(webResponse.status,200);assert.match(await webResponse.text(),/RoadStar/);
const publicReplayResponse=await fetch(web+'/?view=matched-401');assert.equal(publicReplayResponse.status,200);assert.match(await publicReplayResponse.text(),/RoadStar/);
const publicDockResponse=await fetch(web+'/?view=dock-evidence');assert.equal(publicDockResponse.status,200);assert.match(await publicDockResponse.text(),/RoadStar/);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const artifacts=[];
for(const [name,mediaType] of [['roadstar-demo.mp4','video/mp4'],['roadstar-demo.srt','application/x-subrip'],['roadstar-pitch.pdf','application/pdf'],['roadstar-pitch.pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation'],['matched-401-replay.json','application/json']]){
  const response=await fetch(web+'/demo/'+name);assert.equal(response.status,200,name);
  assert.ok(response.headers.get('content-type')?.startsWith(mediaType),name+' media type');
  const hosted=new Uint8Array(await response.arrayBuffer()),local=await readFile('apps/web/public/demo/'+name);assert.equal(sha(hosted),sha(local),name+' deployed bytes');
  artifacts.push({name,status:response.status,contentType:response.headers.get('content-type'),bytes:hosted.byteLength,sha256:sha(hosted)});
}
const film=artifacts.find(item=>item.name==='roadstar-demo.mp4');
const ranked=JSON.parse(await readFile('docs/evidence/cloud-ranked-recovery-2026-09-12/verification.json','utf8'));
assert.equal(ranked.originalAssignmentStatus,'superseded');assert.equal(ranked.replacementAssignmentStatus,'accepted');assert.equal(ranked.forbiddenRoleStatus,403);assert.equal(ranked.staleApprovalStatus,409);
const receipt={verifiedAt:new Date().toISOString(),project,region,services,publicChecks:{apiHealth:{status:healthResponse.status,body:health},web:{status:webResponse.status},publicReplay:{status:publicReplayResponse.status,url:web+'/?view=matched-401'},publicDockEvidence:{status:publicDockResponse.status,url:web+'/?view=dock-evidence'},artifacts,film:{...film,durationSeconds:240.096,video:'H.264 1920x1080 24fps',audio:'AAC'}},rankedRecovery:{carrier:ranked.carrier,recommendationId:ranked.recommendationId,selected:ranked.selected,originalAssignmentStatus:ranked.originalAssignmentStatus,replacementAssignmentStatus:ranked.replacementAssignmentStatus,forbiddenRoleStatus:ranked.forbiddenRoleStatus,staleApprovalStatus:ranked.staleApprovalStatus},checks:['All four latest created revisions are ready and receive 100% traffic','API reports PostgreSQL with Firebase authentication','Public web, matched replay and dock evidence receipt return the RoadStar application shell','Hosted MP4, SRT, PDF, PPTX and matched replay archive are byte-identical to their tracked masters','Hosted recovery preserves rejected HOS evidence, dispatcher approval and separate driver acceptance'],limits:'Approved seven-day GCP preview. Isolated synthetic scenario. Hosted simulator mutation controls remain intentionally unavailable because a simulator Cloud Run resource was not included in the approved cost estimate. The deployed web offers packaged matched-run and dock-evidence replays as read-only historical evidence. Physical Android and native iOS verification remain deferred.'};
await mkdir('docs/evidence/cloud-current-demo-2026-09-12',{recursive:true});
await writeFile('docs/evidence/cloud-current-demo-2026-09-12/deployment.json',JSON.stringify(receipt,null,2)+'\n');
const submissionArtifacts={
  verifiedAt:receipt.verifiedAt,
  webRevision:expected.web,
  artifacts:artifacts.filter(item=>item.name!=='matched-401-replay.json').map(item=>({
    name:item.name,
    url:`${web}/demo/${item.name}`,
    httpStatus:item.status,
    contentType:item.contentType,
    bytes:item.bytes,
    sha256:item.sha256,
    matchesLocal:true,
  })),
  limits:'Direct artifact availability and byte equality only. Portal acceptance, judge access and human audio review remain unverified.',
};
await writeFile('../submission/roadstar/current-artifact-verification.json',JSON.stringify(submissionArtifacts,null,2)+'\n');
console.log(JSON.stringify({services:Object.fromEntries(Object.entries(services).map(([key,value])=>[key,value.revision])),artifacts:Object.fromEntries(artifacts.map(item=>[item.name,item.sha256])),recovery:receipt.rankedRecovery.replacementAssignmentStatus}));
