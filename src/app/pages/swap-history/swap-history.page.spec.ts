import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SwapHistoryPage } from './swap-history.page';

describe('SwapHistoryPage', () => {
  let component: SwapHistoryPage;
  let fixture: ComponentFixture<SwapHistoryPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(SwapHistoryPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
