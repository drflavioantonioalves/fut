import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import {createServer} from 'node:http';
import {Server} from 'socket.io';
import {PrismaClient,MatchStatus} from '@prisma/client';

const prisma=new PrismaClient();
const app=express();
const server=createServer(app);
app.use(helmet());
app.use(cors({origin:process.env.CORS_ORIGIN?.split(',')||true,credentials:true}));
app.use(express.json({limit:'1mb'}));

app.get('/health',(_,res)=>res.json({ok:true,service:'futliga-api'}));
app.get('/api/championships',async(_,res)=>{
 const data=await prisma.championship.findMany({
  include:{club:true,phases:true,teams:true,matches:{include:{homeTeam:true,awayTeam:true,events:true,roster:true}},awards:true,sponsors:true},
  orderBy:{createdAt:'desc'}
 });
 res.json(data);
});
app.get('/api/matches/:id',async(req,res)=>{
 const data=await prisma.match.findUnique({where:{id:req.params.id},
  include:{homeTeam:true,awayTeam:true,events:{orderBy:{createdAt:'asc'}},roster:true,championship:true}});
 if(!data)return res.status(404).json({error:'Partida não encontrada'});
 res.json(data);
});
app.post('/api/matches/:id/status',async(req,res)=>{
 const status=req.body.status as MatchStatus;
 if(!Object.values(MatchStatus).includes(status))return res.status(400).json({error:'Status inválido'});
 const data=await prisma.match.update({where:{id:req.params.id},data:{
  status,
  startedAt:status===MatchStatus.FIRST_HALF?new Date():undefined,
  secondHalfAt:status===MatchStatus.SECOND_HALF?new Date():undefined,
  finishedAt:status===MatchStatus.FINISHED?new Date():undefined
 }});
 io.to('match:'+data.id).emit('match:status',data);
 res.json(data);
});

const io=new Server(server,{cors:{origin:process.env.CORS_ORIGIN?.split(',')||'*'}});
io.on('connection',socket=>{
 socket.on('match:join',(id:string)=>socket.join('match:'+id));
 socket.on('match:leave',(id:string)=>socket.leave('match:'+id));
});

server.listen(Number(process.env.PORT||3000),()=>console.log('FutLiga API online'));
