import { useCallback, useEffect, useState } from 'react'
import { App, Button, Card, Drawer, Form, Input, Select, Space, Table, Tag, TreeSelect, Typography } from 'antd'
import type { OrgReferenceData } from '@contracts/index'
import { api, errorMessage } from '@next/shared/api'
import { ErrorBlock, LoadingBlock, PageHeader } from '@next/shared/ui'
import { useAuth } from '@next/shared/auth'
import { useAntFormUnsavedChanges } from '@next/shared/unsaved-changes'
type Node = {id:string; parent_id:string|null; code:string; name:string; factory_id:string|null; payroll_company_id:string|null; pricing_site_id:string|null; status:string; revision:number; canManage:boolean; children?:Node[]}
export default function HierarchyWorkspace() {
 const {message}=App.useApp(); const {user,refresh}=useAuth(); const [nodes,setNodes]=useState<Node[]>([]); const [org,setOrg]=useState<OrgReferenceData|null>(null); const [error,setError]=useState(''); const [editing,setEditing]=useState<Node|'new'|null>(null); const [form]=Form.useForm()
 useAntFormUnsavedChanges(form, editing!==null, editing==='new'?'新增组织':'编辑组织')
 const groupAdmin=!!user?.grants.some(g=>g.type==='group' && g.capability==='org.manage')
 const load=useCallback(async()=>{try {const [n,o]=await Promise.all([api.get<Node[]>('/org/nodes'),api.get<OrgReferenceData>('/org/tree')]);setNodes(n);setOrg(o);setError('')}catch(e){setError(errorMessage(e))}},[])
 useEffect(()=>{void load()},[load])
 const children=(parent:string|null):Node[]=>nodes.filter(n=>n.parent_id===parent && n.status!=='archived').map(n=>{const nested=children(n.id);return {...n,children:nested.length?nested:undefined}})
 const open=(row?:Node,parent?:Node)=>{setEditing(row||'new'); form.resetFields();form.setFieldsValue({parentId:parent?.id||null,status:'active',payrollCompanyId:parent?.payroll_company_id,pricingSiteId:parent?.pricing_site_id,...(row?{parentId:row.parent_id,code:row.code,name:row.name,status:row.status==='archived'?'inactive':row.status,payrollCompanyId:row.payroll_company_id,pricingSiteId:row.pricing_site_id}:{})})}
 const save=async()=>{try{const input=await form.validateFields(); if(editing && editing!=='new')await api.put(`/org/nodes/${editing.id}`,{...input,revision:editing.revision});else await api.post('/org/nodes',input);setEditing(null);await refresh();await load();message.success('已保存')}catch(e){message.error(errorMessage(e))}}
 if(error)return <ErrorBlock message={error} onRetry={()=>void load()}/>
 if(!org)return <LoadingBlock rows={6}/>
 const treeOptions=(parent:string|null):any[]=>nodes.filter(n=>n.parent_id===parent && n.status==='active' && n.id!==(editing && editing!=='new'?editing.id:null)).map(n=>({value:n.id,title:n.name,children:treeOptions(n.id)}))
 const editingNode = editing && editing !== 'new' ? editing : null
 const subNodes = editingNode ? nodes.filter(n=>n.parent_id===editingNode.id && n.status!=='archived') : []
 return <div><PageHeader title="组织管理" eyebrow="ORGANIZATION" description="按需要建立组织层级，展开或折叠查看下级；发薪主体与计价归属分别设置。" actions={<Space><Button onClick={()=>void load()}>刷新</Button>{groupAdmin&&<Button type="primary" onClick={()=>open()}>新增组织</Button>}</Space>}/>
 <Card><Table<Node> rowKey="id" pagination={false} dataSource={children(null)} columns={[
 {title:'组织名称',dataIndex:'name'},{title:'编码',dataIndex:'code'},
 {title:'发薪主体',render:(_,n)=>org.companies.find(c=>c.id===n.payroll_company_id)?.name||'未设置'},
 {title:'计价归属',render:(_,n)=>org.bases.find(b=>b.id===n.pricing_site_id)?.name||'未设置'},
 {title:'状态',render:(_,n)=>n.status==='active'?'启用':'停用'},
 {title:'操作',render:(_,n)=>n.canManage&&<Button type="link" onClick={()=>open(n)}>编辑</Button>}
 ]}/></Card>
 <Drawer title={editing==='new'?'新增组织':`编辑组织 · ${editingNode?.name ?? ''}`} width={520} open={!!editing} onClose={()=>setEditing(null)} extra={<Button type="primary" onClick={()=>void save()}>保存</Button>}><Form form={form} layout="vertical">
 <Form.Item name="parentId" label="上级组织"><TreeSelect allowClear disabled={!groupAdmin} treeData={treeOptions(null)}/></Form.Item>
 <Form.Item name="code" label="编码" rules={[{required:true}]}><Input/></Form.Item><Form.Item name="name" label="名称" rules={[{required:true}]}><Input/></Form.Item>
 <Form.Item name="payrollCompanyId" label="发薪主体" extra="与计价归属分别保存；人员月度发薪仍以确认结果为准。"><Select allowClear disabled={!groupAdmin} options={org.companies.filter(c=>!c.isGroup&&c.payrollEnabled&&c.status==='active').map(c=>({value:c.id,label:c.name}))}/></Form.Item>
 <Form.Item name="pricingSiteId" label="计价归属" extra="选择后该组织可用于作业、班组和人员管理。"><Select allowClear disabled={!groupAdmin || !!(editing && editing!=='new' && editing.factory_id)} options={org.bases.filter(b=>b.status==='active'&&b.siteConfirmed).map(b=>({value:b.id,label:b.name}))}/></Form.Item>
 <Form.Item name="status" label="状态"><Select options={[{value:'active',label:'启用'},{value:'inactive',label:'停用'}]}/></Form.Item>
 </Form>
 {editingNode?.canManage && <Card size="small" title="下级组织" style={{marginTop:8}} extra={<Button size="small" onClick={()=>open(undefined,editingNode)}>新增下级</Button>}>
   {subNodes.length===0 && <Typography.Text type="secondary">暂无下级组织。</Typography.Text>}
   {subNodes.map(n=><div key={n.id} style={{display:'flex',justifyContent:'space-between',padding:'4px 0'}}>
     <span>{n.name} <Tag>{n.code}</Tag></span>
     <span>{n.status==='active'?'启用':'停用'}</span>
   </div>)}
 </Card>}
 </Drawer></div>
}
