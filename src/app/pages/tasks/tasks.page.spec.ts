import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { BehaviorSubject } from 'rxjs';

import { TasksPage } from './tasks.page';
import { TaskHistoryService } from '../../core/services/task-history.service';
import { Task } from '../../core/models/task.model';

class MockTaskHistoryService {
  tasks$ = new BehaviorSubject<Task[]>([]);
  addTask = jasmine.createSpy('addTask').and.returnValue(Promise.resolve());
  updateStatus = jasmine.createSpy('updateStatus').and.returnValue(Promise.resolve());
}

describe('TasksPage', () => {
  let component: TasksPage;
  let fixture: ComponentFixture<TasksPage>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [TasksPage],
      imports: [IonicModule.forRoot(), ReactiveFormsModule],
      providers: [{ provide: TaskHistoryService, useClass: MockTaskHistoryService }]
    }).compileComponents();

    fixture = TestBed.createComponent(TasksPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
