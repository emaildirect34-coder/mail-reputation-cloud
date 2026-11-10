import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { PageHeader, Panel, Pill, DataTable } from '@/components/dash/kit';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { AiDiagnostic } from '@/components/dash/ai-diagnostic';
import { aiSkills } from '@/lib/ai.schemas';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getMyAccess } from '@/lib/team.functions';

export const Route = createFileRoute('/dashboard/agent')({
  head: () => ({ meta: [
    { title: 'IA Gateway & diagnostics — Email Direct' },
    { name: 'description', content: 'Diagnostics spécialisés pour objets, contenu email, authentification DNS et événements SMTP, avec validation des corrections.' },
    { property: 'og:title', content: 'IA Gateway — Email Direct' },
    { property: 'og:description', content: 'Analyse sur demande et corrections contrôlées de vos campagnes.' },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' },
  ] }), component: Agent,
});
function Agent() {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [report, setReport] = useState('');
  const [objective, setObjective] = useState('');
  const fetchAccess = useServerFn(getMyAccess);
  const { data: access } = useQuery({ queryKey: ['my-access'], queryFn: () => fetchAccess() });
  return <>
    <PageHeader title="IA Gateway" desc="Diagnostics & corrections contrôlées" action={<Pill>Sur demande</Pill>}/>
    <Panel title="Analyse de campagne">
      <div className="space-y-4">
        <label className="block space-y-2 text-sm font-semibold">Objet<Input aria-label="Objet à analyser" value={subject} onChange={e=>setSubject(e.target.value)} maxLength={500}/></label>
        <AiDiagnostic input={{skill:'subject',subject,body}} before={subject} onApply={setSubject}/>
        <label className="block space-y-2 text-sm font-semibold">Contenu email<Textarea aria-label="Contenu à analyser" value={body} onChange={e=>setBody(e.target.value)} maxLength={40000} className="min-h-40"/></label>
        <AiDiagnostic input={{skill:'content',subject,body}} before={body} onApply={setBody}/>
      </div>
    </Panel>
    <Panel title="Rapport de délivrabilité">
      <div className="space-y-3">
        <label className="block space-y-2 text-sm font-semibold">Rapport ou métriques<Textarea value={report} onChange={e => setReport(e.target.value)} maxLength={40000} placeholder="Collez les codes SMTP, alertes, dates ou métriques agrégées." /></label>
        <p className="text-sm text-muted-foreground">Retirez les adresses des destinataires et les identifiants avant l’analyse.</p>
        <AiDiagnostic input={{ skill: 'report', body: report }} />
      </div>
    </Panel>
    {access?.role === 'superadmin' && <Panel title="Plan d’action infrastructure">
      <div className="space-y-3">
        <label className="block space-y-2 text-sm font-semibold">Problème ou objectif<Textarea value={objective} onChange={e => setObjective(e.target.value)} maxLength={40000} /></label>
        <AiDiagnostic input={{ skill: 'plan', body: objective }} />
      </div>
    </Panel>}
    <Panel title="Skills spécialisés"><DataTable cols={['Skill','Données','Correction']} rows={Object.entries(aiSkills).filter(([key]) => key !== 'plan' || access?.role === 'superadmin').map(([key,s])=>[s.title,key==='dns'?'Contrôles DNS et états DKIM':key==='logs'?'200 derniers événements et 20 alertes':key==='plan'?'Objectif, événements et alertes':key==='draft'?'Objectif et audience':'Texte fourni',key==='subject'||key==='content'||key==='draft'?'Proposition avant / après':'Recommandations uniquement'])}/></Panel>
    <Panel title="Connexions IA"><div className="space-y-3 text-sm"><div className="flex flex-wrap items-center gap-2"><strong>Lovable AI Gateway</strong><Pill>GPT-6 Astra</Pill></div><div className="flex flex-wrap items-center gap-2"><strong>OAuth ChatGPT / Claude</strong><Pill tone="warn">Non connecté</Pill></div><p className="text-muted-foreground">Les abonnements ChatGPT et Claude ne sont pas raccordés à cette console; aucune connexion OAuth n’est simulée.</p></div></Panel>
    <Panel title="Actions rapides"><div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link to="/dashboard/campaigns/new">Campaign Builder</Link></Button><Button variant="outline" asChild><Link to="/dashboard/domains">Domaines & DNS</Link></Button><Button variant="outline" asChild><Link to="/dashboard/logs">Logs & événements</Link></Button></div></Panel>
  </>;
}
