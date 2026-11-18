import {PrismaClient} from '@prisma/client';

const db=new PrismaClient();
const services=[
  {name:'Alineación',category:'Cauchera',description:'Alineación de ruedas para mejorar la estabilidad y el desgaste uniforme de los cauchos.'},
  {name:'Balanceo estático',category:'Cauchera',description:'Balanceo estático de ruedas para reducir vibraciones durante la conducción.'},
  {name:'Balanceo dinámico',category:'Cauchera',description:'Balanceo dinámico de ruedas para corregir vibraciones en movimiento.'},
  {name:'Reparación de cauchos',category:'Cauchera',description:'Inspección y reparación de cauchos según el tipo y la ubicación del daño.'},
  {name:'Instalación de sistemas de blindaje para cauchos',category:'Cauchera',description:'Instalación de sistemas de blindaje para cauchos. Compatibilidad y alcance se confirman en el taller.'},
  {name:'Sensores TPMS',category:'Cauchera',description:'Servicio de sensores TPMS para monitoreo de presión de los cauchos.'},
  {name:'Mecánica ligera (tren delantero y trasero)',category:'Mecánica',description:'Revisión y atención de mecánica ligera en tren delantero y trasero.'},
  {name:'Frenos',category:'Mecánica',description:'Revisión y servicio del sistema de frenos.'},
  {name:'Servicio de escáner y entonación',category:'Mecánica',description:'Diagnóstico electrónico con escáner y servicio de entonación.'},
  {name:'Limpieza de inyectores',category:'Mecánica',description:'Limpieza del sistema de inyección para ayudar a mantener el rendimiento del motor.'},
  {name:'Rectificación de discos de freno',category:'Mecánica',description:'Evaluación y rectificación de discos de freno cuando sus condiciones lo permitan.'},
];

try{
  await db.$transaction(async tx=>{
    await tx.service.updateMany({where:{name:{notIn:services.map(service=>service.name)}},data:{active:false}});
    await tx.service.updateMany({where:{name:{in:['Alineación y balanceo','Revisión de frenos']}},data:{active:false}});
    for(const service of services){
      const existing=await tx.service.findFirst({where:{name:service.name}});
      if(existing){
        await tx.service.update({where:{id:existing.id},data:{...service,active:true}});
      }else{
        await tx.service.create({data:{...service,durationMin:30,priceCents:0,active:true}});
      }
    }
  });
  console.log(`Catálogo Protires actualizado: ${services.length} servicios activos. Asigna duración y precios desde administración.`);
}finally{
  await db.$disconnect();
}
