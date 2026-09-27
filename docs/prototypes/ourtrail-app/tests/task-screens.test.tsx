import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { beforeEach, expect, it } from 'vitest';
import { runtime } from '../src/app/runtime';
import { Field } from '../src/screens/Field';
import { StaffTask } from '../src/screens/StaffTask';
import { VehicleTask } from '../src/screens/VehicleTask';
import { Weather } from '../src/screens/Weather';

beforeEach(() => { runtime.setDemoTime('2026-09-24T07:00:00+08:00'); runtime.setOffline(false); });

it('车辆联系人仅看本车，另行返程不计入应到人数', () => {
  runtime.resetDemo('closing'); runtime.setDemoUser('u-driver');
  render(<MemoryRouter initialEntries={['/activities/a1/vehicles/v1']}><Routes><Route path="/activities/:activityId/vehicles/:vehicleId" element={<VehicleTask />} /></Routes></MemoryRouter>);
  expect(screen.queryByText(/紧急联系人|健康备注|分车方案/)).not.toBeInTheDocument();
  expect(screen.getByText('苏晴')).toBeVisible();
  expect(screen.getByText(/另行返程/)).toBeVisible();
  expect(screen.queryByRole('button', { name: /确认.*到家/ })).not.toBeInTheDocument();
});

it('协作任务只显示分管人员', () => {
  runtime.resetDemo('active'); runtime.setDemoUser('u-staff');
  render(<MemoryRouter initialEntries={['/activities/a1/staff']}><Routes><Route path="/activities/:activityId/staff" element={<StaffTask />} /></Routes></MemoryRouter>);
  expect(screen.getByText('林溪', { selector: '.person-row strong' })).toBeVisible();
  expect(screen.queryByText('方乐')).not.toBeInTheDocument();
});

it('收尾同时显示未到家人员和未结异常，没有全员安全按钮', () => {
  runtime.resetDemo('closing'); runtime.setDemoUser('u-owner');
  render(<MemoryRouter><Field activityId="a1" /></MemoryRouter>);
  expect(screen.getByText('待到家 2 人')).toBeVisible();
  expect(screen.getByText('未结异常 1 项')).toBeVisible();
  expect(screen.queryByRole('button', { name: /全员.*安全/ })).not.toBeInTheDocument();
});

it('超预测范围保留所选日期但不显示天气数字', () => {
  runtime.resetDemo('signup'); runtime.setDemoUser('u-lin');
  render(<MemoryRouter initialEntries={['/activities/a1/weather']}><Routes><Route path="/activities/:activityId/weather" element={<Weather />} /></Routes></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('查看日期'), { target: { value: '2026-12-01' } });
  expect(screen.getByText(/超出.*14/)).toBeVisible();
  expect(screen.queryByText(/18°C/)).not.toBeInTheDocument();
});
