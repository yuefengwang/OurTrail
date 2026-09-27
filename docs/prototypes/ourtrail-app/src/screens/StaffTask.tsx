import { useParams } from 'react-router';
import { Field } from './Field';

export function StaffTask() {
  const { activityId = '' } = useParams();
  return <><header className="stack"><span className="eyebrow">现场协作</span><h2 className="page-title">照顾好这一小队。</h2><p className="muted">这里只展示当前仍授权给你的人员与任务；授权变更后立即生效。</p></header><Field activityId={activityId} perspective="staff" /></>;
}
