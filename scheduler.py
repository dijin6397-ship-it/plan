from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import math

class WorkOrder:
    def __init__(self, id: str, name: str, duration: float):
        self.id = id
        self.name = name
        self.duration = duration
        self.start_time: Optional[datetime] = None
        self.end_time: Optional[datetime] = None

class SBOP:
    def __init__(self, id: str, name: str):
        self.id = id
        self.name = name
        self.orders: List[WorkOrder] = []
        self.start_time: Optional[datetime] = None
        self.end_time: Optional[datetime] = None

class MaintenancePhase:
    def __init__(self, id: str, name: str):
        self.id = id
        self.name = name
        self.sbops: List[SBOP] = []
        self.start_time: Optional[datetime] = None
        self.end_time: Optional[datetime] = None

class Scheduler:
    def __init__(self, daily_hours: int = 8, work_start_hour: int = 8, work_end_hour: int = 17):
        self.daily_hours = daily_hours
        self.work_start_hour = work_start_hour
        self.work_end_hour = work_end_hour
        self.lunch_break_start = 12
        self.lunch_break_end = 13
    
    def is_work_time(self, dt: datetime) -> bool:
        hour = dt.hour
        if hour < self.work_start_hour or hour >= self.work_end_hour:
            return False
        if self.lunch_break_start <= hour < self.lunch_break_end:
            return False
        return True
    
    def get_next_work_time(self, dt: datetime) -> datetime:
        while not self.is_work_time(dt):
            hour = dt.hour
            if hour < self.work_start_hour:
                dt = dt.replace(hour=self.work_start_hour, minute=0, second=0, microsecond=0)
            elif hour >= self.work_end_hour:
                dt = (dt + timedelta(days=1)).replace(hour=self.work_start_hour, minute=0, second=0, microsecond=0)
            elif self.lunch_break_start <= hour < self.lunch_break_end:
                dt = dt.replace(hour=self.lunch_break_end, minute=0, second=0, microsecond=0)
            else:
                dt += timedelta(minutes=1)
        return dt
    
    def add_work_hours(self, start: datetime, hours: float) -> datetime:
        current = self.get_next_work_time(start)
        remaining_minutes = hours * 60
        
        while remaining_minutes > 0:
            if not self.is_work_time(current):
                current = self.get_next_work_time(current)
                continue
            
            minutes_to_work = min(remaining_minutes, 1)
            current += timedelta(minutes=minutes_to_work)
            remaining_minutes -= minutes_to_work
            
            if current.hour == self.lunch_break_start and current.minute == 0:
                current = current.replace(hour=self.lunch_break_end)
            
            if current.hour >= self.work_end_hour:
                current = (current + timedelta(days=1)).replace(hour=self.work_start_hour, minute=0, second=0, microsecond=0)
        
        return current
    
    def schedule(self, phases_data: List[Dict], start_time: datetime) -> Dict[str, Any]:
        phases = []
        
        for phase_data in phases_data:
            phase = MaintenancePhase(phase_data['id'], phase_data['name'])
            phase.start_time = self.get_next_work_time(start_time)
            
            for sbop_data in phase_data.get('sbops', []):
                sbop = SBOP(sbop_data['id'], sbop_data['name'])
                sbop.start_time = phase.start_time
                
                for order_data in sbop_data.get('orders', []):
                    order = WorkOrder(
                        order_data['id'],
                        order_data['name'],
                        float(order_data.get('duration', 0))
                    )
                    # 如果有显式的起止日期，则使用它们
                    if order_data.get('startDate') and order_data.get('endDate'):
                        order.start_time = datetime.fromisoformat(order_data['startDate'])
                        order.end_time = datetime.fromisoformat(order_data['endDate'])
                    else:
                        order.start_time = self.get_next_work_time(sbop.start_time)
                        order.end_time = self.add_work_hours(order.start_time, order.duration)
                    sbop.orders.append(order)
                
                if sbop.orders:
                    sbop.start_time = min(o.start_time for o in sbop.orders)
                    sbop.end_time = max(o.end_time for o in sbop.orders)
                else:
                    sbop.end_time = sbop.start_time
                phase.sbops.append(sbop)
            
            if phase.sbops:
                phase.start_time = min(s.start_time for s in phase.sbops)
                phase.end_time = max(s.end_time for s in phase.sbops)
            else:
                phase.end_time = phase.start_time
            phases.append(phase)
        
        return self._to_dict(phases)
    
    def _to_dict(self, phases: List[MaintenancePhase]) -> Dict[str, Any]:
        result = {
            'phases': [],
            'totalDuration': 0
        }
        
        total_start = None
        total_end = None
        
        for phase in phases:
            phase_dict = {
                'id': phase.id,
                'name': phase.name,
                'startTime': phase.start_time.isoformat() if phase.start_time else None,
                'endTime': phase.end_time.isoformat() if phase.end_time else None,
                'sbops': []
            }
            
            if total_start is None or (phase.start_time and phase.start_time < total_start):
                total_start = phase.start_time
            if total_end is None or (phase.end_time and phase.end_time > total_end):
                total_end = phase.end_time
            
            for sbop in phase.sbops:
                sbop_dict = {
                    'id': sbop.id,
                    'name': sbop.name,
                    'startTime': sbop.start_time.isoformat() if sbop.start_time else None,
                    'endTime': sbop.end_time.isoformat() if sbop.end_time else None,
                    'orders': []
                }
                
                for order in sbop.orders:
                    order_dict = {
                        'id': order.id,
                        'name': order.name,
                        'duration': order.duration,
                        'startTime': order.start_time.isoformat() if order.start_time else None,
                        'endTime': order.end_time.isoformat() if order.end_time else None
                    }
                    sbop_dict['orders'].append(order_dict)
                
                phase_dict['sbops'].append(sbop_dict)
            
            result['phases'].append(phase_dict)
        
        if total_start and total_end:
            result['totalDuration'] = (total_end - total_start).total_seconds() / 3600
            result['totalStartTime'] = total_start.isoformat()
            result['totalEndTime'] = total_end.isoformat()
        
        return result
